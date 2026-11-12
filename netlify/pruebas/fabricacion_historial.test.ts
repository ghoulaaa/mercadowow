// Etapa 5: historial de una receta (SQL 0041 y fabricacion_historial.js).

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { serieHistorial, subarbolReceta } from "../../app/static/fabricacion_historial.js";
import { crearApi } from "../lib/api.ts";

const TSM = "tsm:forever:us:pvp-horde";
const AHL = "ahledger:forever:us:pvp-horde";

// Gold Bar (3577) ← Iron Bar (3575, fundible) ← Iron Ore (2772). Y un ciclo de esencias aparte.
const DATOS = {
  tope_pct: 150, comision_pct: 5,
  recetas: [
    { s: 11479, n: "Transmute: Iron to Gold", p: "Alchemy", l: 225, r: 3577, mn: 1, mx: 1, m: [[3575, 1]] },
    { s: 3307, n: "Smelt Iron", p: "Mining", l: 125, r: 3575, mn: 1, mx: 1, m: [[2772, 1]] },
    { s: 1, n: "Mayor", p: "Enchanting", l: 1, r: 11, mn: 1, mx: 1, m: [[10, 3]] },
    { s: 2, n: "Menor", p: "Enchanting", l: 1, r: 10, mn: 3, mx: 3, m: [[11, 1]] },
  ],
  objetos: { 3577: { n: "Gold Bar", h: 2000 }, 3575: { n: "Iron Bar" }, 2772: { n: "Iron Ore" }, 10: { n: "L" }, 11: { n: "G" } },
};
const H = ["2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z", "2026-11-10T12:00:00Z"];
const HIST = {
  escaneos: H,
  series: {
    // [hora, compra mínima, valor de mercado, unidades, ventas/día]
    3577: [[H[0], 2000, 2000, 5, null], [H[1], 1800, 2000, 7, null], [H[2], 2100, 2000, 4, null]],
    3575: [[H[0], 488, 490, 30, null], [H[1], 400, 490, 30, null], [H[2], 600, 590, 30, null]],
    2772: [[H[0], 440, 450, 80, null], [H[1], 450, 450, 80, null]],   // sin precio en el último escaneo
  },
};

describe("serie de una receta", () => {
  test("subárbol: producto, ingredientes y lo que se puede fabricar; sin colgarse en ciclos", () => {
    const s = subarbolReceta(DATOS, 11479)!;
    assert.deepEqual(s.ids, [2772, 3575, 3577]);
    assert.deepEqual(s.recetas.map((r: any) => r.s).sort((a: number, b: number) => a - b), [3307, 11479]);
    assert.deepEqual(subarbolReceta(DATOS, 1)!.ids, [10, 11]);
    assert.equal(subarbolReceta(DATOS, 999), null);
  });
  test("cada escaneo pasa por el mismo motor: comprar o fabricar según los precios de esa hora", () => {
    const r = serieHistorial(DATOS, 11479, HIST)!;
    assert.equal(r.escaneos, 3);
    // 10:00 → barra fundida 440 (más barata que 488); 11:00 → barra comprada 400; 12:00 → sin mineral: comprada 600.
    assert.deepEqual(r.puntos.map((p: any) => p[2]), [440, 400, 600]);
    assert.deepEqual(r.puntos.map((p: any) => p[1]), [2000, 1800, 2100]);
    assert.deepEqual(r.puntos.map((p: any) => p[3]), [2000 - 100 - 440, 1800 - 90 - 400, 2100 - 105 - 600]);
    assert.deepEqual(r.puntos.map((p: any) => p[4]), [5, 7, 4]);
    assert.deepEqual(r.coste, { actual: 600, min: 400, max: 600, media: 480, n: 3 });
    assert.equal(r.neta.max, 1460);
    assert.equal(r.desde, Date.parse(H[0]));
  });
  test("sin fabricar intermedios, la barra siempre se compra", () => {
    const r = serieHistorial(DATOS, 11479, HIST, { fabricarIntermedios: false })!;
    assert.deepEqual(r.puntos.map((p: any) => p[2]), [488, 400, 600]);
  });
  test("no inventa: un escaneo sin precio de venta ni de material deja el punto vacío", () => {
    const h = { escaneos: [H[0], H[1]], series: { 3575: [[H[0], 488, 490, 1, null]] } };
    const r = serieHistorial(DATOS, 11479, h, { valorSinOfertas: false })!;
    assert.deepEqual(r.puntos.map((p: any) => [p[1], p[2], p[3]]), [[null, 488, null], [null, null, null]]);
    assert.deepEqual(r.neta, { actual: null, min: null, max: null, media: null, n: 0 });
  });
});

describe("historial_fabricacion (SQL) y API", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  async function escaneo(mk: string, hora: string, filas: [number, number | null, number | null, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [mk, hora]);
    for (const [id, min, valor, q] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [mk, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, quantity, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $5::bigint, $6::integer, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [mk, id, hora, min, valor, q]);
    }
  }
  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                     "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql",
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0022_mapa.sql", "0024_perfil_subasta.sql", "0025_oportunidades.sql",
                     "0026_region.sql", "0028_recetas_tsm.sql", "0029_mapa_casa.sql", "0030_listas_alertas.sql", "0038_planes_a_medida.sql",
                     "0039_cantidades_ahledger.sql", "0040_datos_fabricacion.sql", "0041_historial_fabricacion.sql"]) await pg.exec(leer(n));
    await escaneo(TSM, "2026-11-01T09:10:00Z", [[2589, 100, 100, null]]);          // fuera de 7 días
    await escaneo(TSM, "2026-11-10T10:15:00Z", [[2589, 200, 210, null], [1251, 600, 580, null]]);
    await escaneo(TSM, "2026-11-10T11:20:00Z", [[2589, 190, 205, null]]);           // 1251 no aparece
    await escaneo(AHL, "2026-11-10T11:40:00Z", [[2589, 185, 200, 8921]]);
  });

  test("precios por escaneo dentro del periodo, con las unidades de AHledger en la misma hora", async () => {
    const r = (await uno("select historial_fabricacion($1, $2::integer[], 7) as r", [TSM, [2589, 1251, 999]])).r;
    assert.deepEqual(r.escaneos.map((h: string) => new Date(h).toISOString()), ["2026-11-10T10:00:00.000Z", "2026-11-10T11:00:00.000Z"]);
    assert.equal(new Date(r.primer_escaneo).toISOString(), "2026-11-01T09:10:00.000Z");
    assert.equal(r.cantidades_de, "AHledger");
    assert.deepEqual(r.series["2589"].map((p: any[]) => p.slice(1, 4)), [[200, 210, null], [190, 205, 8921]]);
    assert.equal(r.series["1251"].length, 1);
    assert.equal(r.series["999"], undefined);
    const todo = (await uno("select historial_fabricacion($1, $2::integer[], 30) as r", [TSM, [2589]])).r;
    assert.equal(todo.escaneos.length, 3);
  });
  test("validación", async () => {
    await assert.rejects(uno("select historial_fabricacion($1, $2::integer[], 5) as r", [TSM, [1]]), /Periodo no válido/);
    await assert.rejects(uno("select historial_fabricacion($1, '{}'::integer[], 7) as r", [TSM]), /Entre 1 y 300/);
    await assert.rejects(uno("select historial_fabricacion('x', $1::integer[], 7) as r", [[1]]), /Mercado desconocido/);
  });
  test("API /api/recetas?historial=1", async () => {
    const db = { consulta: async (sql: string, params: unknown[]) => (await pg.query<any>(sql, params)).rows };
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db as any, { clave: CLAVE, mercado: TSM, proyecto: "p" } as any);
    const l = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = l.headers.get("set-cookie")!.split(";")[0];
    const pedir = (q: string) => api.recetas(new Request(`https://x/api/recetas?historial=1&${q}`, { headers: { cookie } }));
    const r = await pedir("ids=2589,1251&dias=7");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).escaneos.length, 2);
    assert.equal((await pedir("ids=a,b&dias=7")).status, 400);
    assert.equal((await pedir("ids=1&dias=3")).status, 400);
    assert.equal((await pedir("dias=7")).status, 400);
  });
});
