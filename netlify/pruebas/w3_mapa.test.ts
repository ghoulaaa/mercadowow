// W3 (plan V4): mapa de materiales. Distribución, color con signo y variación de la misma métrica.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { abreviar, pesoBloque, squarify, textoVariacion, tonoVariacion } from "../../app/static/treemap.js";

const TSM = "tsm:forever:us:pvp-horde";
const AHL = "ahledger:forever:us:pvp-horde";

describe("distribución squarified", () => {
  const pesos = [6, 6, 4, 3, 2, 2, 1].map((peso) => ({ peso }));
  const r = squarify(pesos, 0, 0, 600, 400);

  test("cada bloque tiene un área proporcional a su peso y nada se sale", () => {
    assert.equal(r.length, pesos.length);
    const total = pesos.reduce((s, p) => s + p.peso, 0);
    for (const b of r) {
      assert.ok(Math.abs(b.w * b.h - (pesos[b.i].peso / total) * 600 * 400) < 1e-6);
      assert.ok(b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.w <= 600 + 1e-6 && b.y + b.h <= 400 + 1e-6);
    }
    assert.ok(Math.abs(r.reduce((s, b) => s + b.w * b.h, 0) - 600 * 400) < 1e-6);
  });
  test("no hay solapes", () => {
    for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++) {
      const A = r[a], B = r[b];
      const sola = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) > 1e-6 && Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > 1e-6;
      assert.ok(!sola, `${a} y ${b} se solapan`);
    }
  });
  test("tamaño uniforme: bloques casi cuadrados (relación ≤ 3)", () => {
    const u = squarify(Array.from({ length: 12 }, () => ({ peso: 1 })), 0, 0, 400, 300);
    for (const b of u) assert.ok(Math.max(b.w / b.h, b.h / b.w) <= 3, JSON.stringify(b));
  });
  test("sin elementos o sin espacio: nada", () => {
    assert.deepEqual(squarify([], 0, 0, 100, 100), []);
    assert.deepEqual(squarify([{ peso: 1 }], 0, 0, 0, 100), []);
  });
});

describe("color, texto y tamaño", () => {
  test("tres pasos por lado, neutro con |v| < 1 y aspecto propio sin historial (nunca «0 %»)", () => {
    assert.deepEqual([0.4, -0.9, 2, 7, 30, -2, -7, -30].map(tonoVariacion),
      ["igual", "igual", "sube-1", "sube-2", "sube-3", "baja-1", "baja-2", "baja-3"]);
    assert.equal(tonoVariacion(null), "sin");
    assert.equal(textoVariacion(null), null);
  });
  test("variación siempre con signo", () => {
    assert.equal(textoVariacion(12.34), "+12,3 %");
    assert.equal(textoVariacion(-4), "−4,0 %");
    assert.equal(textoVariacion(0), "0,0 %");
  });
  test("tamaño: cantidad solo si la fuente la publica; si no, uniforme", () => {
    assert.equal(pesoBloque({ cantidad: 500 }, "cantidad"), 500);
    assert.equal(pesoBloque({ cantidad: null }, "cantidad"), 0);
    assert.equal(pesoBloque({ cantidad: 500 }, "uniforme"), 1);
  });
  test("nombre abreviado por palabras", () => {
    assert.equal(abreviar("Linen Cloth", 20), "Linen Cloth");
    assert.equal(abreviar("Elemental Fire Essence", 12), "Elemental…");
  });
});

describe("mapa_materiales (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const mapa = async (p: object = {}, m = TSM) => (await uno("select mapa_materiales($1, $2::jsonb) as r", [m, JSON.stringify(p)])).r;
  const obj = (r: any, id: number) => r.familias.flatMap((f: any) => f.objetos).find((o: any) => o.id === id);

  async function escaneo(mercado: string, hora: string, filas: [number, number | null, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [mercado, hora]);
    for (const [id, min, cant] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [mercado, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, quantity, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, 99999, $5::integer, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [mercado, id, hora, min, cant]);
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
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0022_mapa.sql"]) await pg.exec(leer(n));
    const cat = [
      { id: 765, name: "Silverleaf", itemClass: "Trade Goods", itemSubclass: "Herb" },
      { id: 2447, name: "Peacebloom", itemClass: "Trade Goods", itemSubclass: "Herb" },
      { id: 2589, name: "Linen Cloth", itemClass: "Trade Goods", itemSubclass: "Cloth" },
      { id: 3371, name: "Empty Vial", itemClass: "Trade Goods", itemSubclass: "Other" },
      { id: 118, name: "Minor Healing Potion", itemClass: "Consumable", itemSubclass: "Potions" },
    ].map((x) => ({ ...x, quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await uno("select guardar_recetas('forever', 'Alchemy', $1::jsonb)", [JSON.stringify([{
      spell_id: 2330, nombre: "Minor Healing Potion", nivel_requerido: 1, obtencion: "trainer", resultado_id: 118,
      resultado_nombre: "Minor Healing Potion", cantidad_min: 1, cantidad_max: 1,
      reactivos: [{ item_id: 765, nombre: "Silverleaf", cantidad: 1 }, { item_id: 2447, nombre: "Peacebloom", cantidad: 1 },
                  { item_id: 3371, nombre: "Empty Vial", cantidad: 1 }] }])]);
    await uno("select guardar_recetas('forever', 'First Aid', $1::jsonb)", [JSON.stringify([{
      spell_id: 3275, nombre: "Linen Bandage", nivel_requerido: 1, obtencion: "trainer", resultado_id: 1251,
      resultado_nombre: "Linen Bandage", cantidad_min: 1, cantidad_max: 1, reactivos: [{ item_id: 2589, nombre: "Linen Cloth", cantidad: 1 }] }])]);
    // Hace ~24 h y ahora. Peacebloom no tiene escaneo de hace 24 h → «sin historial». Empty Vial nunca se vio.
    await escaneo(TSM, "2026-11-08T19:16:24Z", [[765, 100, null], [2589, 20, null]]);
    await escaneo(TSM, "2026-11-09T13:00:00Z", [[2447, 50, null]]);
    await escaneo(TSM, "2026-11-09T19:16:24Z", [[765, 125, null], [2589, 20, null], [2447, 55, null]]);
  });

  test("solo materiales de recetas, agrupados por familia; tamaño uniforme con TSM", async () => {
    const r = await mapa();
    assert.equal(r.tamano, "uniforme");
    assert.deepEqual(r.familias.map((f: any) => [f.familia, f.objetos.length]), [["hierbas", 2], ["telas", 1], ["comercio_otros", 1]]);
    assert.equal(obj(r, 118), undefined);   // un producto no es material
  });

  test("variación: misma métrica y mercado, ~24 h antes; sin referencia → sin historial; nunca vista → sin datos", async () => {
    const r = await mapa({ periodo: "24h" });
    assert.deepEqual([obj(r, 765).precio, obj(r, 765).precio_ref, Number(obj(r, 765).variacion)], [125, 100, 25]);
    assert.equal(Number(obj(r, 2589).variacion), 0);
    assert.deepEqual([obj(r, 2447).estado, obj(r, 2447).variacion], ["con_ofertas", null]);   // 6 h no son 24 h
    assert.deepEqual([obj(r, 3371).estado, obj(r, 3371).precio], ["sin_datos", null]);
    assert.equal(r.con_variacion, 2);
    const semana = await mapa({ periodo: "7d" });
    assert.equal(semana.con_variacion, 0);
  });

  test("filtros: profesión, familia y solo con ofertas", async () => {
    assert.deepEqual((await mapa({ profesion: "First Aid" })).familias.map((f: any) => f.familia), ["telas"]);
    assert.deepEqual((await mapa({ familia: "hierbas" })).familias[0].objetos.map((o: any) => o.id).sort(), [2447, 765]);
    assert.equal((await mapa({ solo_ofertas: true })).total, 3);
  });

  test("con AHledger el tamaño es la cantidad publicada", async () => {
    await escaneo(AHL, "2026-11-09T19:17:23Z", [[765, 120, 300], [2589, 22, 9000]]);
    const r = await mapa({}, AHL);
    assert.equal(r.tamano, "cantidad");
    assert.equal(obj(r, 2589).cantidad, 9000);
  });

  for (const [nombre, p, patron] of [["periodo no válido", { periodo: "1y" }, /Periodo no válido/],
                                     ["familia desconocida", { familia: "rocas" }, /Familia desconocida/]] as const) {
    test(`rechaza: ${nombre}`, async () => assert.rejects(mapa(p), patron));
  }
});
