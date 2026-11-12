// Etapa 2: datos de la vista «Fabricación» (SQL 0040) y tabla sin DOM (fabricacion_tabla.js).

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { calcularFilas, filasACsv, filtrarFilas, ordenarFilas, prepararDatos } from "../../app/static/fabricacion_tabla.js";
import { crearApi } from "../lib/api.ts";

const TSM = "tsm:forever:us:pvp-horde";
const AHL = "ahledger:forever:us:pvp-horde";

// Datos con la forma de datos_fabricacion().
const DATOS = {
  mercado: TSM, demo: false, escaneo: "2026-11-12T15:22:37Z", cantidades: null, tope_pct: 150, comision_pct: 5,
  recetas: [
    { s: 1, n: "Venda de lino", p: "First Aid", l: 1, r: 1251, mn: 1, mx: 1, m: [[2589, 2]] },
    { s: 2, n: "Barra de hierro", p: "Mining", l: 125, r: 3575, mn: 1, mx: 1, m: [[2772, 1]] },
    { s: 3, n: "Transmutar: hierro a oro", p: "Alchemy", l: 150, r: 3577, mn: 1, mx: 1, m: [[3575, 1]] },
    { s: 4, n: "Poción rara", p: "Alchemy", l: 200, r: 9999, mn: 1, mx: 3, m: [[8831, 1], [3371, 1]] },
    { s: 5, n: "Capa con pérdidas", p: "Tailoring", l: 50, r: 5000, mn: 1, mx: 1, m: [[2589, 10]] },
  ],
  objetos: {
    2589: { n: "Linen Cloth", s: 200, v: 210, c: 500 },
    1251: { n: "Linen Bandage", s: 600, v: 580, c: 40, d: 12 },
    2772: { n: "Iron Ore", s: 440, v: 450, c: 80 },
    3575: { n: "Iron Bar", s: 488, v: 500, c: 30 },
    3577: { n: "Gold Bar", s: 2000, v: 1000, c: 5, dg: 3 },        // 2000 > 150 % de 1000 → tope 1500
    8831: { n: "Purple Lotus", v: 900 },                             // sin ofertas ahora
    3371: { n: "Empty Vial", npc: 4, npc_tuyo: true },
    9999: { n: "Rare Potion", s: 5000, v: 5000 },
    5000: { n: "Cloak", s: 1500, v: 1500 },
  },
};

describe("tabla de fabricación (sin DOM)", () => {
  const filas = calcularFilas(DATOS);
  const por = (spell: number) => filas.find((f: any) => f.spell === spell);

  test("ejemplo de la especificación con datos de la API", () => {
    const f = por(1);
    assert.deepEqual([f.coste, f.precioVenta, f.bruta, f.neta], [400, 600, 200, 170]);
    assert.equal(f.roi, 42.5);
    assert.equal(f.disponible, 40);
    assert.equal(f.ventasDia, 12);
  });
  test("el material intermedio se fabrica si sale más barato (barra fundida)", () => {
    const f = por(3);
    assert.equal(f.a.materiales[0].origen, "fabricar");
    assert.equal(f.coste, 440);
  });
  test("tope del valor de venta: 150 % del valor de mercado", () => {
    const f = por(3);
    assert.equal(f.precioVenta, 1500);
    assert.equal(f.topeAplicado, true);
    assert.equal(f.ventasRegion, 3);
  });
  test("material sin ofertas: valor de mercado marcado, o receta incompleta si se desactiva", () => {
    const f = por(4);
    assert.deepEqual(f.materialesSinOfertas, [8831]);
    assert.equal(f.coste, 904);                       // 900 (valor de mercado) + 4 (NPC)
    const sin = calcularFilas(DATOS, { valorSinOfertas: false }).find((x: any) => x.spell === 4);
    assert.equal(sin.completo, false);
    assert.equal(sin.neta, null);
  });
  test("desglose: cada ingrediente con su precio, origen y coste; los fabricados con sus propios ingredientes", () => {
    const g = por(3).desglose();
    assert.equal(g.materiales.length, 1);
    const barra = g.materiales[0];
    assert.deepEqual([barra.nombre, barra.cantidad, barra.precioUnitario, barra.costeTotal, barra.origen], ["Iron Bar", 1, 440, 440, "fabricar"]);
    assert.deepEqual([barra.comprar, barra.fabricar, barra.ahorroFabricando, barra.recetaIntermedia], [488, 440, 48, 2]);
    assert.equal(barra.hijos.length, 1);
    assert.deepEqual([barra.hijos[0].nombre, barra.hijos[0].cantidad, barra.hijos[0].precioUnitario, barra.hijos[0].origen],
                     ["Iron Ore", 1, 440, "subasta"]);
    // La suma del desglose es exactamente el coste de la fila.
    assert.equal(g.materiales.reduce((s: number, m: any) => s + m.costeTotal, 0), por(3).coste);

    const p = por(4).desglose();
    assert.deepEqual(p.materiales.map((m: any) => [m.nombre, m.origen, m.precioUnitario]),
                     [["Purple Lotus", "subasta_sin_ofertas", 900], ["Empty Vial", "npc_tuyo", 4]]);
    const venda = por(1).desglose().materiales[0];
    assert.deepEqual([venda.cantidad, venda.precioUnitario, venda.costeTotal, venda.disponible, venda.hijos], [2, 200, 400, 500, []]);
  });
  test("prepararDatos convierte la forma corta de la API", () => {
    const { recetas, precios } = prepararDatos(DATOS);
    assert.deepEqual(recetas[3].materiales, [{ id: 8831, cantidad: 1 }, { id: 3371, cantidad: 1 }]);
    assert.equal(precios.get(3371).npc, 4);
    assert.equal(precios.get(8831).sinOfertas, true);
  });
  test("comisión configurable (casa neutral)", () => {
    const f = calcularFilas(DATOS, { regla: { comision_pct: 15, deposito_pct: 60, deposito_minimo: 100, redondeo: "floor" } })
      .find((x: any) => x.spell === 1);
    assert.equal(f.neta, 600 - 90 - 400);
  });
  test("precios simulados a mano", () => {
    const f = calcularFilas(DATOS, { manual: { 2589: 100 } }).find((x: any) => x.spell === 1);
    assert.equal(f.coste, 200);
  });

  test("filtros: profesión, ROI mínimo, rentables, nivel, texto e ID", () => {
    const ids = (f: object) => filtrarFilas(filas, f).map((x: any) => x.spell);
    assert.deepEqual(ids({ profesiones: ["Alchemy"] }), [3, 4]);
    assert.deepEqual(ids({ soloRentables: true }), [1, 2, 3, 4]);
    assert.deepEqual(ids({ roiMin: 100 }), [3, 4]);
    assert.deepEqual(ids({ nivelMin: 100, nivelMax: 150 }), [2, 3]);
    assert.deepEqual(ids({ texto: "POCION" }), [4]);
    assert.deepEqual(ids({ texto: "2589" }), [1, 5]);          // ID de material
    assert.deepEqual(ids({ soloMaterialesEnVenta: true }).includes(4), false);
    assert.deepEqual(ids({ soloConVentas: true }), [1, 3]);
  });
  test("orden por ganancia neta y por ROI; desconocidos al final", () => {
    const conNull = [...filas, { ...filas[0], spell: 99, neta: null, roi: null }];
    assert.deepEqual(ordenarFilas(conNull, "neta", "desc").map((x: any) => x.spell).at(-1), 99);
    assert.deepEqual(ordenarFilas(conNull, "neta", "asc").map((x: any) => x.spell).at(-1), 99);
    const porNeta = ordenarFilas(filas, "neta", "desc").map((x: any) => x.spell);
    assert.equal(porNeta[0], 4);
    assert.equal(porNeta.at(-1), 5);                           // la capa da pérdidas
    assert.ok(por(5).neta < 0);
  });
  test("CSV con cobre entero y comillas cuando hace falta", () => {
    const csv = filasACsv([por(1)], () => 'Venda "de lino", grande');
    const [cab, l] = csv.trim().split("\r\n");
    assert.ok(cab.startsWith("spell,item_id,objeto"));
    assert.equal(l, '1,1251,"Venda ""de lino"", grande",First Aid,1,600,400,200,170,42.50,28.33,40,12,true');
  });
});

describe("datos_fabricacion (SQL)", () => {
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
                     "0039_cantidades_ahledger.sql", "0040_datos_fabricacion.sql"]) await pg.exec(leer(n));
    const cat = [[2589, "Linen Cloth"], [1251, "Linen Bandage"]]
      .map(([id, name]) => ({ id, name, itemClass: "Trade Goods", itemSubclass: "Cloth", quality: "COMMON", vendorSell: 13 }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await uno(`select guardar_recetas('forever', 'First Aid', $1::jsonb)`, [JSON.stringify([{
      spell_id: 3275, nombre: "Linen Bandage", nivel_requerido: 1, obtencion: "trainer", resultado_id: 1251,
      resultado_nombre: "Linen Bandage", cantidad_min: 1, cantidad_max: 1,
      reactivos: [{ item_id: 2589, nombre: "Linen Cloth", cantidad: 2 }, { item_id: 3371, nombre: "Empty Vial", cantidad: 1 }] }])]);
    await escaneo(TSM, "2026-11-12T14:00:00Z", [[2589, 150, 150, null]]);
    await escaneo(TSM, "2026-11-12T15:22:37Z", [[2589, 200, 210, null], [1251, null, 580, null]]);
  });

  test("recetas y objetos del último escaneo; sin precio = sin clave", async () => {
    const d = (await uno("select datos_fabricacion($1) as r", [TSM])).r;
    assert.equal(new Date(d.escaneo).toISOString(), "2026-11-12T15:22:37.000Z");
    assert.equal(d.cantidades, null);
    assert.equal(Number(d.tope_pct), 150);
    assert.deepEqual(d.recetas, [{ s: 3275, n: "Linen Bandage", p: "First Aid", l: 1, o: "trainer", r: 1251, mn: 1, mx: 1,
                                   m: [[2589, 2], [3371, 1]] }]);
    assert.deepEqual(d.objetos["2589"], { n: "Linen Cloth", q: "COMMON", s: 200, v: 210, vn: 13 });
    assert.deepEqual(d.objetos["1251"], { n: "Linen Bandage", q: "COMMON", v: 580, vn: 13 });
    assert.deepEqual(d.objetos["3371"], { n: "Empty Vial" });       // sin precio en ninguna parte
  });

  test("compra al NPC introducida por ti y cantidades de AHledger", async () => {
    await pg.query("insert into precios_npc (game_type, item_id, precio) values ('forever', 3371, 4)");
    await escaneo(AHL, "2026-11-12T15:40:00Z", [[2589, 190, 200, 8921]]);
    const d = (await uno("select datos_fabricacion($1) as r", [TSM])).r;
    assert.equal(d.objetos["3371"].npc, 4);
    assert.equal(d.objetos["3371"].npc_tuyo, true);
    assert.equal(d.objetos["2589"].c, 8921);
    assert.equal(d.objetos["2589"].cr, true);
    assert.equal(d.objetos["2589"].s, 200);                          // el precio sigue siendo de TSM
    assert.equal(d.cantidades.proveedor, "AHledger");
    // Y de punta a punta con el motor: 2 × 200 + 4 = 404.
    const f = calcularFilas(d)[0];
    assert.equal(f.coste, 404);
    assert.equal(f.precioVenta, 580);
  });

  test("mercado desconocido: error claro", async () => {
    await assert.rejects(uno("select datos_fabricacion('no:existe') as r"), /Mercado desconocido/);
  });

  test("API: /api/recetas?fabricacion=1 llama a datos_fabricacion", async () => {
    const consultas: string[] = [];
    const db = { consulta: async (sql: string, params: unknown[]) => { consultas.push(sql); return (await pg.query<any>(sql, params)).rows; } };
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db as any, { clave: CLAVE, mercado: TSM, proyecto: "p" } as any);
    const l = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = l.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await api.recetas(new Request("https://x/api/recetas?fabricacion=1"))).status, 401);
    const r = await api.recetas(new Request("https://x/api/recetas?fabricacion=1", { headers: { cookie } }));
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.recetas.length, 1);
    assert.ok(consultas.some((s) => s.includes("datos_fabricacion")));
  });
});
