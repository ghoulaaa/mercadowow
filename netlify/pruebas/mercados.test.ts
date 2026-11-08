// Separación de mercados, importación CSV y datos demo, contra TODAS las migraciones
// portables (0001, 0003, 0004) en PGlite. La 0002 (pg_cron/pg_net) se sustituye por un doble.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ejecutar } from "../../supabase/functions/actualizar-mercado/nucleo.ts";
import { crearApi, type Db } from "../lib/api.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const TSM = "tsm:forever:us:pvp-horde", CSV = "csv:forever:us:pvp-horde", DEMO = "demo:forever:us:demo";
const AHORA = "2026-11-08T03:00:00Z";
const FILAS = [
  { item_id: 2770, name: "Mena de cobre", min_buyout: 1250, market_value: 1300, recent: null, historical: null },
  { item_id: 2772, name: "Mena de hierro", min_buyout: 10500, market_value: null, recent: null, historical: null },
];

let pg: PGlite;
let db: Db;
const uno = async (q: string, p: unknown[] = []) => (await pg.query<any>(q, p)).rows[0];
const importar = (mk: string, hora: string, filas: unknown[] = FILAS) =>
  uno("select importar_precios($1, $2::timestamptz, $3::text::jsonb, 'prueba.csv', $4::timestamptz) as r",
    [mk, hora, JSON.stringify(filas), AHORA]).then((x) => x.r);
const porMercado = async (tabla: string) => Object.fromEntries((await pg.query<any>(
  `select m.key, count(t.*)::int n from markets m left join ${tabla} t on t.market_id = m.id group by m.key`)).rows
  .map((r) => [r.key, r.n]));

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated;");
  await pg.exec(leer("0001_esquema.sql"));
  await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
  await pg.exec(leer("0003_web.sql"));
  await pg.exec(leer("0004_demo_csv.sql"));
  db = { consulta: async (q, p) => (await pg.query<Record<string, unknown>>(q, p)).rows };
});

describe("mercados", () => {
  test("existen los tres, separados y bien etiquetados", async () => {
    const lista = (await uno("select listar_mercados() as r")).r;
    assert.deepEqual(lista.map((m: any) => [m.clave, m.ficticio, m.automatico]),
      [[TSM, false, true], [CSV, false, false], [DEMO, true, false]]);
    assert.match(lista[2].nombre, /FICTICIOS/);
  });

  test("la descarga de TSM sigue funcionando y queda con origen tsm", async () => {
    const csv = "itemId,name,marketValue,minBuyout,recent,historical,updatedAt\n1,X,10,9,9,11,2026-11-07T22:16:24Z\n";
    const r = await ejecutar(db, {
      mercado: TSM, ahora: () => new Date(AHORA),
      fetch: (async () => new Response(csv, { status: 200, headers: { ETag: '"a"' } })) as typeof fetch,
    });
    assert.equal(r.estado, "nuevo_dato");
    assert.equal((await uno("select origen from snapshots")).origen, "tsm");
  });
});

describe("importación CSV", () => {
  test("guarda en el mercado csv con origen csv y nombre de archivo", async () => {
    const r = await importar(CSV, "2026-11-08T02:00:00Z");
    assert.equal(r.estado, "nuevo_dato");
    assert.equal(r.filas, 2);
    const s = await uno("select origen, nombre_archivo, row_count from snapshots");
    assert.deepEqual(s, { origen: "csv", nombre_archivo: "prueba.csv", row_count: 2 });
    assert.deepEqual(await porMercado("price_hourly"), { [TSM]: 0, [CSV]: 2, [DEMO]: 0 });
    const log = await uno("select status, message from fetch_log");
    assert.equal(log.status, "nuevo_dato");
    assert.match(log.message, /Importación CSV: prueba\.csv/);
  });

  test("NO se puede importar en el mercado TSM ni en el demo", async () => {
    await assert.rejects(importar(TSM, "2026-11-08T02:00:00Z"), /importación manual/);
    await assert.rejects(importar(DEMO, "2026-11-08T02:00:00Z"), /importación manual/);
    await assert.rejects(importar("tsm:retail:us:area-52", "2026-11-08T02:00:00Z"), /desconocido/);
    assert.equal((await uno("select count(*)::int n from price_hourly")).n, 0);
  });

  test("mismo archivo dos veces: no duplica", async () => {
    await importar(CSV, "2026-11-08T02:00:00Z");
    const r = await importar(CSV, "2026-11-08T02:00:00Z");
    assert.equal(r.estado, "sin_cambios");
    assert.equal((await uno("select count(*)::int n from snapshots")).n, 1);
  });

  test("archivo más antiguo que el último: se ignora", async () => {
    await importar(CSV, "2026-11-08T02:00:00Z");
    assert.equal((await importar(CSV, "2026-11-07T02:00:00Z")).estado, "sin_cambios");
  });

  for (const [nombre, hora, filas, patron] of [
    ["hora futura", "2026-11-09T00:00:00Z", FILAS, /futuro/],
    ["sin filas", "2026-11-08T02:00:00Z", [], /no tiene filas/],
    ["fila sin nombre", "2026-11-08T02:00:00Z", [{ item_id: 1, name: " ", min_buyout: 5 }], /sin nombre/],
    ["precio negativo", "2026-11-08T02:00:00Z", [{ item_id: 1, name: "X", min_buyout: -5 }], /check/],
  ] as const) {
    test(`rechaza: ${nombre}`, async () => {
      await assert.rejects(importar(CSV, hora, filas as unknown[]), patron);
      assert.equal((await uno("select count(*)::int n from snapshots")).n, 0);
    });
  }
});

describe("datos de demostración", () => {
  test("genera datos FICTICIOS solo en el mercado demo", async () => {
    const r = (await uno("select generar_demo(30, $1::timestamptz) as r", [AHORA])).r;
    assert.equal(r.objetos, 16);
    assert.ok(r.filas > 16 * 30 * 24 * 0.8, `filas=${r.filas}`);
    assert.deepEqual(await porMercado("snapshots"), { [TSM]: 0, [CSV]: 0, [DEMO]: 720 });
    const n = await uno("select count(*) filter (where name like '[FICTICIO]%')::int f, count(*)::int t from items");
    assert.equal(n.f, n.t);
    assert.equal((await uno("select count(distinct origen)::int n, min(origen) o from snapshots")).o, "demo");
    const fueraDeRango = await uno("select count(*)::int n from price_hourly where min_buyout <= 0 or market_value <= 0");
    assert.equal(fueraDeRango.n, 0);
  });

  test("es determinista y regenerar no toca otros mercados", async () => {
    await importar(CSV, "2026-11-08T02:00:00Z");
    await uno("select generar_demo(5, $1::timestamptz) as r", [AHORA]);
    const a = await uno("select sum(min_buyout)::text s from price_hourly p join markets m on m.id = p.market_id where m.is_demo");
    await uno("select generar_demo(5, $1::timestamptz) as r", [AHORA]);
    const b = await uno("select sum(min_buyout)::text s from price_hourly p join markets m on m.id = p.market_id where m.is_demo");
    assert.equal(a.s, b.s);
    assert.deepEqual(await porMercado("price_hourly"), { [TSM]: 0, [CSV]: 2, [DEMO]: (await porMercado("price_hourly"))[DEMO] });
    assert.equal((await porMercado("price_hourly"))[CSV], 2);
  });

  test("perfiles: el escaso aparece en pocas horas, el del pico sube al final", async () => {
    await uno("select generar_demo(30, $1::timestamptz) as r", [AHORA]);
    const escaso = await uno("select count(*)::int n from price_hourly where item_id = 900002");
    assert.ok(escaso.n > 150 && escaso.n < 350, `escaso=${escaso.n}`);
    const pico = await uno(`select avg(min_buyout) filter (where hour > $1::timestamptz - interval '1 day') /
                                   avg(min_buyout) filter (where hour < $1::timestamptz - interval '5 days') as k
                              from price_hourly where item_id = 900009`, [AHORA]);
    assert.ok(Number(pico.k) > 1.4, `pico=${pico.k}`);
  });

  test("días fuera de rango: error", async () => {
    await assert.rejects(uno("select generar_demo(0) as r"), /entre 1 y 60/);
    await assert.rejects(uno("select generar_demo(61) as r"), /entre 1 y 60/);
  });
});

describe("la base de datos impide mezclar mercados", () => {
  test("una versión no puede tener un origen distinto al de su mercado", async () => {
    await assert.rejects(pg.query(
      "insert into snapshots (market_id, origen, source_updated_at, row_count) select id, 'tsm', now(), 1 from markets where key = $1", [DEMO]),
      /no corresponde/);
  });

  test("un precio no puede apuntar a una versión de otro mercado", async () => {
    await importar(CSV, "2026-11-08T02:00:00Z");
    await assert.rejects(pg.query(
      `insert into price_hourly (market_id, item_id, hour, min_buyout, snapshot_id)
       select (select id from markets where key = $1), 1, now(), 5, id from snapshots limit 1`, [TSM]),
      /misma_version_mismo_mercado|foreign key/);
  });
});

describe("API (Netlify) de importación y demo", () => {
  const CLAVE = "una-clave-larga-de-prueba";
  const api = () => crearApi(db, { clave: CLAVE, mercado: TSM, proyecto: "abcd", ahora: () => new Date(AHORA) });
  const cookie = async () => (await api().login(new Request("https://x/api/login",
    { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1")).headers.get("set-cookie")!.split(";")[0];
  const post = (ruta: string, cuerpo: unknown, c?: string) => new Request("https://x" + ruta, {
    method: "POST", body: JSON.stringify(cuerpo), headers: c ? { cookie: c } : {},
  });

  test("sin sesión no se importa ni se genera nada", async () => {
    assert.equal((await api().importar(post("/api/importar", {}))).status, 401);
    assert.equal((await api().demo(post("/api/demo", {}))).status, 401);
  });

  test("importar: OK en csv, 422 con mensaje claro en tsm", async () => {
    const c = await cookie();
    const ok = await api().importar(post("/api/importar",
      { mercado: CSV, hora_dato: "2026-11-08T02:00:00Z", nombre_archivo: "a.csv", filas: FILAS }, c));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).estado, "nuevo_dato");
    const mal = await api().importar(post("/api/importar",
      { mercado: TSM, hora_dato: "2026-11-08T02:00:00Z", nombre_archivo: "a.csv", filas: FILAS }, c));
    assert.equal(mal.status, 422);
    assert.match((await mal.json()).error, /importación manual/);
    assert.equal((await api().importar(post("/api/importar", { mercado: CSV }, c))).status, 400);
  });

  test("demo y estado por mercado", async () => {
    const c = await cookie();
    const d = await api().demo(post("/api/demo", { dias: 2 }, c));
    assert.equal(d.status, 200);
    assert.equal((await api().demo(post("/api/demo", { dias: 99 }, c))).status, 400);
    const e = await (await api().estado(new Request(`https://x/api/estado?mercado=${encodeURIComponent(DEMO)}`,
      { headers: { cookie: c } }))).json();
    assert.equal(e.mercado.ficticio, true);
    assert.equal(e.mercado.automatico, false);
    assert.equal(e.actualizacion.objetos, 16);
    assert.equal(e.mercados.length, 3);
    assert.equal(e.mercado_principal, TSM);
    const n = await api().estado(new Request("https://x/api/estado?mercado=no-existe", { headers: { cookie: c } }));
    assert.equal(n.status, 404);
  });
});
