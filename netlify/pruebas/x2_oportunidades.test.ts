// X2 (plan V5): oportunidades de compra — gangas, bajo precio de NPC, margen y orden por margen.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { paramsMercado, textoReglaGanga, verMargen } from "../../app/static/mercado.js";
import { formatearMoneda } from "../../app/static/moneda.js";

const TSM = "tsm:forever:us:pvp-horde";

test("parámetros: solo se envían las oportunidades conocidas", () => {
  assert.deepEqual(paramsMercado({ oportunidad: "ganga" }), { oportunidad: "ganga" });
  assert.deepEqual(paramsMercado({ oportunidad: "npc", orden: "margen", dir: "desc" }), { oportunidad: "npc", orden: "margen", dir: "desc" });
  assert.deepEqual(paramsMercado({ oportunidad: "" }), {});
  assert.deepEqual(paramsMercado({ oportunidad: "loquesea" }), {});
});

test("la columna Margen se ve con el filtro o al ordenar por margen", () => {
  assert.equal(verMargen({ oportunidad: "", orden: "nombre" }), false);
  assert.equal(verMargen({ oportunidad: "todas", orden: "nombre" }), true);
  assert.equal(verMargen({ oportunidad: "", orden: "margen_pct" }), true);
});

test("la regla de las gangas se escribe con los números del servidor", () => {
  const t = textoReglaGanga({ comision_pct: 5, historico_min_pct: 80, tramos: [[1000000, 70], [100000, 60], [10000, 50], [0, 40]] }, formatearMoneda);
  assert.match(t, /40 % \(menos de 1o\)/);
  assert.match(t, /50 % \(de 1o a 10o\)/);
  assert.match(t, /70 % \(desde 100o\)/);
  assert.match(t, /al menos el 80 %/);
  assert.equal(textoReglaGanga(undefined, formatearMoneda), "");
});

describe("oportunidades (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const pagina = async (p: object = {}) => (await uno("select mercado_pagina($1, $2::jsonb) as r", [TSM, JSON.stringify(p)])).r;
  const fila = async (id: number, p: object = {}) => (await pagina(p)).filas.find((f: any) => f.id === id);
  const ids = async (p: object) => (await pagina(p)).filas.map((f: any) => f.id).sort((a: number, b: number) => a - b);

  // [id, compra mínima, valor de mercado, histórico]
  async function escaneo(hora: string, filas: [number, number | null, number | null, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [TSM, hora]);
    for (const [id, min, mv, hist] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [TSM, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, historical, quantity, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $5::bigint, $6::bigint, 10, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [TSM, id, hora, min, mv, hist]);
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
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0025_oportunidades.sql"]) await pg.exec(leer(n));
    const cat = [
      { id: 2589, name: "Linen Cloth", itemClass: "Trade Goods", itemSubclass: "Cloth" },
      { id: 2840, name: "Copper Bar", itemClass: "Trade Goods", itemSubclass: "Metal & Stone" },
      { id: 2770, name: "Copper Ore", itemClass: "Trade Goods", itemSubclass: "Metal & Stone" },
      { id: 765, name: "Silverleaf", itemClass: "Trade Goods", itemSubclass: "Herb" },
      { id: 118, name: "Minor Healing Potion", itemClass: "Consumable", itemSubclass: "Potions" },
      { id: 1530, name: "Bandage", itemClass: "Consumable", itemSubclass: "Bandages" },
      { id: 2880, name: "Weak Flux", itemClass: "Trade Goods", itemSubclass: "Trade Goods" },
      { id: 6661, name: "Recipe: Savory Deviate Delight", itemClass: "Recipe", itemSubclass: "Cooking" },
      { id: 6533, name: "Aquadynamic Fish Attractor", itemClass: "Consumable", itemSubclass: "Other" },
      { id: 16083, name: "Expert Fishing - The Bass and You", itemClass: "Recipe", itemSubclass: "Fishing" },
      { id: 19019, name: "Thunderfury", itemClass: "Weapon", itemSubclass: "Sword" },
    ].map((x) => ({ ...x, quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await pg.exec("update catalogo set venta_npc = 500 where item_id in (1530, 2880); update catalogo set venta_npc = 100 where item_id = 6533;");
    // Escaneo antiguo: 16083 parecía una ganga, pero ya no está en el último escaneo.
    await escaneo("2026-11-09T10:00:00Z", [[16083, 1, 1000, 1000]]);
    await escaneo("2026-11-10T10:00:00Z", [
      [2589, 800, 2000, 2000],              // 40 % justo del valor de mercado (tramo < 1 o): ganga
      [2840, 801, 2000, 2000],              // un cobre por encima: no
      [2770, 9000, 20000, 15000],           // histórico al 75 % del valor de mercado: no
      [765, 9000, 20000, null],             // sin histórico: no se supone
      [118, 1400000, 2000000, 1600000],     // 70 % (tramo ≥ 100 o) e histórico al 80 % justo: ganga
      [1530, 300, 310, 310],                // bajo el NPC (500); revender en la subasta perdería
      [2880, 300, null, null],              // bajo el NPC sin valor de mercado
      [6661, 1500, 1000, 1000],             // más caro que su valor de mercado
      [6533, 90, 1000, 1000],               // ganga y, además, bajo el NPC (100)
    ]);
  });

  test("umbral por tramos y reventa neta de comisión", async () => {
    const u = async (v: number) => Number((await uno("select _umbral_ganga($1::bigint) as u", [v])).u);
    assert.deepEqual([await u(0), await u(9999), await u(10000), await u(99999), await u(100000), await u(999999), await u(1000000)],
      [40, 40, 50, 50, 60, 60, 70]);
    assert.equal(Number((await uno("select _neto_venta(310, 5) as n")).n), 295);   // la comisión se redondea hacia abajo
    assert.equal((await uno("select _es_ganga(null, 1000, 1000, 5) as g")).g, false);
    assert.equal((await uno("select _es_ganga(100, null, 1000, 5) as g")).g, false);
  });

  test("gangas: en el límite sí, un cobre más no; histórico bajo o desconocido no", async () => {
    assert.deepEqual(await ids({ oportunidad: "ganga" }), [118, 2589, 6533]);
    const a = await fila(2589);
    assert.equal(a.ganga, true);
    assert.equal(a.margen, 1100);                // 2000 − 5 % − 800
    assert.equal(a.margen_pct, 137.5);
    assert.equal(a.margen_tipo, "mercado");
    assert.equal((await fila(2840)).ganga, false);
    assert.equal((await fila(2770)).ganga, false);
    assert.equal((await fila(765)).ganga, false);
    assert.equal((await fila(118)).margen, 500000);
  });

  test("bajo precio de NPC: la ganancia es NPC − compra mínima, sin comisión", async () => {
    assert.deepEqual(await ids({ oportunidad: "npc" }), [1530, 2880, 6533]);
    const f = await fila(1530);
    assert.equal(f.bajo_npc, true);
    assert.equal(f.margen, 200);
    assert.equal(f.margen_tipo, "npc");
    assert.equal(f.venta_npc, 500);
    const sinMercado = await fila(2880);
    assert.equal(sinMercado.margen, 200);
    assert.equal(sinMercado.valor_mercado, null);
    // Si la subasta deja más que el NPC, el margen es el de la subasta.
    const doble = await fila(6533);
    assert.equal(doble.ganga && doble.bajo_npc, true);
    assert.equal(doble.margen, 860);             // 1000 − 5 % − 90, frente a 10 del NPC
    assert.equal(doble.margen_tipo, "mercado");
  });

  test("sin dato no hay margen; un margen negativo se muestra como tal", async () => {
    assert.equal((await fila(19019)).margen, null);            // nunca visto
    const viejo = await fila(16083);                           // solo en un escaneo anterior
    assert.equal(viejo.estado, "sin_ofertas");
    assert.equal(viejo.margen, null);
    assert.equal(viejo.ganga, false);
    assert.equal((await fila(6661)).margen, -550);             // 1000 − 5 % − 1500
    assert.equal((await fila(6661)).ganga, false);
  });

  test("contadores: no dependen de la oportunidad elegida, sí de los demás filtros", async () => {
    const todo = await pagina();
    assert.deepEqual(todo.oportunidades, { ganga: 3, npc: 3, todas: 5 });
    assert.equal(todo.total, 11);
    const soloNpc = await pagina({ oportunidad: "npc" });
    assert.deepEqual(soloNpc.oportunidades, { ganga: 3, npc: 3, todas: 5 });
    assert.equal(soloNpc.total, 3);
    assert.equal((await pagina({ oportunidad: "todas" })).total, 5);
    const consumibles = await pagina({ oportunidad: "ganga", categoria: "Consumable" });
    assert.deepEqual(consumibles.oportunidades, { ganga: 2, npc: 2, todas: 3 });
    assert.deepEqual(consumibles.filas.map((f: any) => f.id).sort((a: number, b: number) => a - b), [118, 6533]);
    assert.deepEqual(todo.reglas_oportunidad, { comision_pct: 5, historico_min_pct: 80, tramos: [[1000000, 70], [100000, 60], [10000, 50], [0, 40]] });
  });

  test("orden por margen y por margen en %; lo desconocido siempre al final", async () => {
    const porMargen = (await pagina({ orden: "margen", dir: "desc" })).filas;
    assert.equal(porMargen[0].id, 118);
    const conDato = porMargen.filter((f: any) => f.margen != null).map((f: any) => f.margen);
    assert.deepEqual(conDato, [...conDato].sort((a, b) => b - a));
    assert.equal(conDato.at(-1), -550);
    assert.ok(porMargen.slice(conDato.length).every((f: any) => f.margen == null));
    const asc = (await pagina({ orden: "margen", dir: "asc" })).filas;
    assert.equal(asc[0].id, 6661);
    assert.equal(asc.at(-1).margen, null);
    const porPct = (await pagina({ orden: "margen_pct", dir: "desc" })).filas;
    assert.equal(porPct[0].id, 6533);            // 860 sobre 90: 955,6 %
    assert.equal(porPct[0].margen_pct, 955.6);
    assert.equal(porPct[1].id, 2589);
  });

  test("la comisión sale de los ajustes del motor", async () => {
    await pg.exec("insert into settings (key, value) values ('motor.comision_pct', '10') on conflict (key) do update set value = excluded.value");
    assert.equal((await fila(2589)).margen, 1000);   // 2000 − 10 % − 800
  });

  test("valores no válidos: se rechazan", async () => {
    await assert.rejects(pagina({ oportunidad: "chollo" }), /Oportunidad no válida/);
    await assert.rejects(pagina({ orden: "ganancia" }), /Orden no válido/);
  });
});
