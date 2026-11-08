// Motor de recomendaciones (migración 0006) contra PGlite, con escenarios controlados.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { crearApi, type Db } from "../lib/api.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const CSV = "csv:forever:us:pvp-horde", DEMO = "demo:forever:us:demo", TSM = "tsm:forever:us:pvp-horde";

let pg: PGlite;
let db: Db;
const q = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows;
const uno = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
const recalc = (mk = CSV, forzar = false) => uno("select recalcular_recomendaciones($1, $2) as r", [mk, forzar]).then((x) => x.r);
const rec = (id: number, mk = CSV) => uno(
  "select r.* from recomendaciones r join markets m on m.id = r.market_id where m.key = $1 and r.item_id = $2", [mk, id]);

/**
 * Crea historial en el mercado csv: una observación cada `cada` horas durante `dias` días
 * hasta `fin`, con el precio que devuelve la expresión SQL `precio` (puede usar d = días hasta el final).
 */
async function historial(itemId: number, dias: number, precio: string, cada = 6, fin = "now()") {
  await q(`insert into items (market_id, item_id, name)
           select id, $1::integer, 'Objeto ' || $1::integer::text from markets where key = $2
           on conflict do nothing`, [itemId, CSV]);
  await q(`
    with m as (select id from markets where key = $1),
    horas as (select date_trunc('hour', ${fin}, 'UTC') - make_interval(hours => h) as hour
                from generate_series(0, $2::integer * 24 - 1, $3::integer) h)
    insert into snapshots (market_id, source_updated_at, row_count)
    select m.id, horas.hour, 1 from m, horas
    on conflict (market_id, source_updated_at) do nothing`, [CSV, dias, cada]);
  await q(`
    insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, snapshot_id)
    select s.market_id, $1::integer, s.source_updated_at,
           round(${precio})::bigint, round(${precio})::bigint, s.id
      from snapshots s join markets m on m.id = s.market_id,
           lateral (select extract(epoch from (date_trunc('hour', ${fin}, 'UTC') - s.source_updated_at)) / 86400.0 as d) x
     where m.key = $2 and s.source_updated_at > date_trunc('hour', ${fin}, 'UTC') - make_interval(days => $3::integer)
       and s.source_updated_at <= date_trunc('hour', ${fin}, 'UTC')
    on conflict do nothing`, [itemId, CSV, dias]);
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated;");
  await pg.exec(leer("0001_esquema.sql"));
  await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
  for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql"]) await pg.exec(leer(n));
  db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
});

describe("perfiles del demo", () => {
  test("cada perfil da la recomendación esperada", async () => {
    await uno("select generar_demo(30, now())");
    await recalc(DEMO);
    const por = async (id: number) => (await rec(id, DEMO));
    assert.equal((await por(900009)).recomendacion, "VENDER");       // poción con pico
    assert.equal((await por(900016)).recomendacion, "VENDER");       // gema con pico
    assert.equal((await por(900006)).recomendacion, "GUARDAR");      // cuero deprimido que antes se recuperaba
    assert.equal((await por(900012)).recomendacion, "GUARDAR");      // polvo deprimido
    const barra = await por(900005);                                 // en caída desde hace días
    assert.equal(barra.recomendacion, "OBSERVACION");
    assert.match(barra.resumen, /caída continuada/);
    assert.match((await por(900001)).resumen, /dentro de lo habitual/); // estable
    assert.match((await por(900004)).resumen, /contradictorias/);        // subida lenta y constante
  });

  test("las explicaciones llevan cifras en oro/plata/cobre y riesgos", async () => {
    await uno("select generar_demo(30, now())");
    await recalc(DEMO);
    const r = await rec(900009, DEMO);
    assert.match(r.motivos[0], /Precio actual \d+o \d+p/);
    assert.match(r.motivos[0], /Medianas propias: 7 días/);
    assert.ok(r.riesgos.some((x: string) => /volumen/.test(x)));
    assert.ok(r.horizonte);
    assert.equal(r.cifras.persistencia >= 2, true);
  });
});

describe("reglas y casos límite", () => {
  test("historial insuficiente: EN OBSERVACIÓN aunque el precio sea muy alto", async () => {
    await historial(1, 3, "case when d < 0.3 then 300 else 100 end");
    await recalc();
    const r = await rec(1);
    assert.equal(r.recomendacion, "OBSERVACION");
    assert.match(r.resumen, /Historial insuficiente/);
  });

  test("VENDER: subida sostenida sobre ambas medianas", async () => {
    await historial(1, 30, "case when d < 0.6 then 140 else 100 end");
    await recalc();
    const r = await rec(1);
    assert.equal(r.recomendacion, "VENDER");
    assert.match(r.resumen, /\+40,0 % sobre la mediana de 30 días/);
  });

  test("un pico de una sola observación no basta para VENDER", async () => {
    await historial(1, 30, "case when d < 0.1 then 140 else 100 end");
    await recalc();
    const r = await rec(1);
    assert.equal(r.recomendacion, "OBSERVACION");
    assert.match(r.resumen, /sin confirmar/);
  });

  test("precio extremo (×5): EN OBSERVACIÓN y confianza de calidad 0", async () => {
    await historial(1, 30, "case when d < 0.6 then 500 else 100 end");
    await recalc();
    const r = await rec(1);
    assert.equal(r.recomendacion, "OBSERVACION");
    assert.match(r.resumen, /extremo/);
    assert.equal(r.desglose.find((x: any) => x.k === "Calidad del precio").puntos, 0);
  });

  test("precio bajo SIN caídas anteriores recuperadas: no es GUARDAR", async () => {
    await historial(1, 30, "case when d < 1 then 70 else 100 end");
    await recalc();
    const r = await rec(1);
    assert.equal(r.recomendacion, "OBSERVACION");
    assert.match(r.resumen, /sin evidencia de recuperación/);
  });

  test("GUARDAR: bajada actual y caídas anteriores que se recuperaron, con horizonte", async () => {
    // Ciclo: cada 6 días, 1 día a 70; el resto a 100. Ahora (últimas 24 h) a 70.
    await historial(1, 30, "case when d < 1 or mod(floor(d)::int, 6) = 3 then 70 else 100 end");
    await recalc();
    const r = await rec(1);
    assert.equal(r.recomendacion, "GUARDAR", JSON.stringify(r.motivos));
    assert.ok(r.cifras.dias_recuperados >= 2);
    assert.match(r.horizonte, /Orientativo: unos [\d,]+ días/);
  });

  test("caída que ya venía de antes: no es GUARDAR aunque hubiera recuperaciones", async () => {
    // Precio que baja de 200 a 100 en 30 días, con rebotes.
    await historial(1, 30, "(100 + d * 3.4) * case when mod(floor(d)::int, 5) = 2 then 0.8 else 1 end");
    await recalc();
    const r = await rec(1);
    assert.notEqual(r.recomendacion, "GUARDAR");
  });

  test("objeto que no está en el último escaneo: EN OBSERVACIÓN sin suponer venta", async () => {
    await historial(1, 30, "100");
    await historial(2, 30, "100", 6, "now() - interval '1 day'");
    await recalc();
    const r = await rec(2);
    assert.equal(r.recomendacion, "OBSERVACION");
    assert.match(r.motivos[0], /no significa que se haya vendido/);
  });
});

describe("lectura: datos antiguos y confianza", () => {
  test("dato con más de 8 h: se fuerza EN OBSERVACIÓN al leer", async () => {
    await historial(1, 30, "case when d < 0.6 then 140 else 100 end", 6, "now() - interval '10 hours'");
    await recalc();
    assert.equal((await rec(1)).recomendacion, "VENDER");
    const fila = (await uno("select tabla_precios($1) as r", [CSV])).r[0];
    assert.equal(fila.rec, "OBSERVACION");
    assert.match(fila.resumen, /^Datos antiguos \(10 h\)/);
    const ex = (await uno("select explicar_objeto($1, 1) as r", [CSV])).r;
    assert.equal(ex.lectura.antiguo, true);
    assert.equal(ex.recomendacion_motor, "VENDER");
  });

  test("la confianza nunca es «Alta» sin datos de liquidez y suma sus partes", async () => {
    await historial(1, 30, "100", 1);   // historial perfecto: 720 observaciones
    await recalc();
    const r = await rec(1);
    assert.equal(r.puntos_base, r.desglose.reduce((s: number, x: any) => s + x.puntos, 0));
    const fila = (await uno("select tabla_precios($1) as r", [CSV])).r[0];
    assert.equal(fila.puntos, 90);
    assert.equal(fila.nivel, "Media");
  });
});

describe("recálculo, ajustes y registro", () => {
  test("solo recalcula si cambian los datos o los ajustes", async () => {
    await historial(1, 30, "100");
    assert.equal((await recalc()).estado, "recalculado");
    assert.equal((await recalc()).estado, "al_dia");
    await uno("select guardar_ajustes('{\"motor.vender_sobre_med7_pct\": 20}'::jsonb)");
    assert.equal((await recalc()).estado, "recalculado");
  });

  test("cambiar un umbral cambia la recomendación", async () => {
    await historial(1, 30, "case when d < 0.6 then 120 else 100 end");
    await recalc();
    assert.equal((await rec(1)).recomendacion, "VENDER");
    await uno("select guardar_ajustes('{\"motor.vender_sobre_med30_pct\": 30}'::jsonb)");
    await recalc();
    assert.equal((await rec(1)).recomendacion, "OBSERVACION");
  });

  for (const [nombre, json, patron] of [
    ["clave desconocida", '{"motor.inventado": 1}', /desconocido/],
    ["fuera de rango", '{"motor.comision_pct": 80}', /entre 0 y 50/],
    ["no numérico", '{"motor.comision_pct": "mucho"}', /número/],
    ["decimal donde va entero", '{"motor.min_observaciones": 10.5}', /entero/],
  ] as const) {
    test(`ajustes: rechaza ${nombre}`, async () => {
      await assert.rejects(uno("select guardar_ajustes($1::jsonb)", [json]), patron);
    });
  }

  test("registro diario: solo VENDER/GUARDAR y favoritos", async () => {
    await historial(1, 30, "case when d < 0.6 then 140 else 100 end");  // VENDER
    await historial(2, 30, "100");                                        // OBSERVACIÓN
    await historial(3, 30, "100");                                        // OBSERVACIÓN favorito
    await uno("select marcar_favorito($1, 3, true)", [CSV]);
    await recalc();
    const ids = (await q("select item_id from recommendation_log order by item_id")).map((x) => x.item_id);
    assert.deepEqual(ids, [1, 3]);
  });

  test("recalcular un mercado no toca las recomendaciones de otro", async () => {
    await uno("select generar_demo(5, now())");
    await recalc(DEMO);
    const antes = Number((await uno("select count(*) n from recomendaciones")).n);
    await historial(1, 30, "100");
    await recalc(CSV);
    assert.equal(Number((await uno("select count(*) n from recomendaciones")).n), antes + 1);
    await recalc(TSM);   // sin datos: no falla y no borra los demás
    assert.equal(Number((await uno("select count(*) n from recomendaciones")).n), antes + 1);
  });

  test("formatos de las explicaciones", async () => {
    assert.equal((await uno("select fmt_moneda(123456) as r")).r, "12o 34p 56c");
    assert.equal((await uno("select fmt_moneda(0) as r")).r, "0c");
    assert.equal((await uno("select fmt_moneda(-500) as r")).r, "−5p");
    assert.equal((await uno("select fmt_pct(0.1234) as r")).r, "+12,3 %");
    assert.equal((await uno("select fmt_pct(-0.05) as r")).r, "−5,0 %");
  });
});

describe("API del motor", () => {
  test("precios incluye recomendación y resumen; explicación y ajustes requieren sesión", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: TSM, proyecto: "p" });
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const get = (ruta: string, c?: string) => new Request("https://x" + ruta, { headers: c ? { cookie: c } : {} });

    assert.equal((await api.explicacion(get("/api/explicacion?id=1"))).status, 401);
    assert.equal((await api.ajustes(get("/api/ajustes"))).status, 401);

    await historial(1, 30, "case when d < 0.6 then 140 else 100 end");
    const p = await (await api.precios(get(`/api/precios?mercado=${CSV}`, cookie))).json();
    assert.equal(p.motor.estado, "recalculado");
    assert.equal(p.resumen.vender, 1);
    assert.equal(p.objetos[0].rec, "VENDER");
    assert.equal(p.objetos[0].neto, 133);     // 140 − 5 %

    const e = await (await api.explicacion(get(`/api/explicacion?mercado=${CSV}&id=1`, cookie))).json();
    assert.equal(e.lectura.rec, "VENDER");
    assert.equal(e.ingreso_neto_unidad, 133);
    assert.equal((await api.explicacion(get(`/api/explicacion?mercado=${CSV}&id=99`, cookie))).status, 404);
    assert.equal((await api.explicacion(get(`/api/explicacion?mercado=${CSV}&id=abc`, cookie))).status, 400);

    const aj = await (await api.ajustes(get("/api/ajustes", cookie))).json();
    assert.equal(aj["motor.comision_pct"], 5);
    const malo = await api.ajustes(new Request("https://x/api/ajustes",
      { method: "POST", body: JSON.stringify({ "motor.comision_pct": 99 }), headers: { cookie } }));
    assert.equal(malo.status, 422);
    const bueno = await api.ajustes(new Request("https://x/api/ajustes",
      { method: "POST", body: JSON.stringify({ "motor.comision_pct": 15 }), headers: { cookie } }));
    assert.equal((await bueno.json())["motor.comision_pct"], 15);
  });
});
