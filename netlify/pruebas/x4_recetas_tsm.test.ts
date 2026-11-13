// X4 (plan V5): recetas al estilo TSM — material más barato (subasta, fabricar, NPC), valor del
// producto con tope, importación verificable de precios de compra al NPC.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { leerPreciosNpc } from "../../app/static/mercado.js";

const TSM = "tsm:forever:us:pvp-horde";

test("CSV de precios al NPC: ID y precio en cobre o con monedas; lo demás es error con su línea", () => {
  const r = leerPreciosNpc("itemId,precio\n3371,4c\n2324, 25\n8343,1o 2p\nhola,3\n4291,");
  assert.deepEqual(r.filas, [{ id: 3371, precio: 4 }, { id: 2324, precio: 25 }, { id: 8343, precio: 10200 }, { id: 4291, precio: null }]);
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0], /Línea 5/);
  assert.deepEqual(leerPreciosNpc("3371;4").filas, [{ id: 3371, precio: 4 }]);
});

describe("recetas TSM (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const objeto = async (id: number, base = "tsm") => (await uno("select recetas_objeto($1, $2::integer, $3) as r", [TSM, id, base])).r;
  const importar = async (filas: object[], aplicar = true) =>
    (await uno("select importar_compra_npc($1, $2::jsonb, $3) as r", [TSM, JSON.stringify(filas), aplicar])).r;

  // [id, compra mínima, valor de mercado]
  async function escaneo(hora: string, filas: [number, number | null, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [TSM, hora]);
    for (const [id, min, mv] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [TSM, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, quantity, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $5::bigint, 10, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [TSM, id, hora, min, mv]);
    }
  }
  const receta = (spell: number, nombre: string, res: number, reactivos: [number, number][], qmin = 1, qmax = 1) => ({
    spell_id: spell, nombre, nivel_requerido: 1, obtencion: null, resultado_id: res, resultado_nombre: nombre,
    resultado_calidad: "COMMON", cantidad_min: qmin, cantidad_max: qmax,
    reactivos: reactivos.map(([item_id, cantidad]) => ({ item_id, nombre: `#${item_id}`, cantidad })),
  });

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                     "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql",
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0025_oportunidades.sql", "0026_region.sql",
                     "0028_recetas_tsm.sql", "0042_recetas_iconos.sql"]) await pg.exec(leer(n));
    const cat = [
      [2770, "Copper Ore"], [2840, "Copper Bar"], [2880, "Weak Flux"], [3371, "Empty Vial"], [2447, "Peacebloom"],
      [118, "Minor Healing Potion"], [2589, "Linen Cloth"], [2996, "Bolt of Linen Cloth"], [4343, "Brown Linen Pants"],
    ].map(([id, name]) => ({ id, name, itemClass: "Trade Goods", itemSubclass: "Parts", quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await pg.exec("update catalogo set venta_npc = 1 where item_id = 3371;");
    await uno("select guardar_recetas('forever', 'Mining', $1::jsonb)", [JSON.stringify([
      receta(2657, "Smelt Copper", 2840, [[2770, 1]]),
    ])]);
    await uno("select guardar_recetas('forever', 'Blacksmithing', $1::jsonb)", [JSON.stringify([
      receta(3115, "Weak Flux", 2880, [[2840, 1]], 1, 3),      // rinde 2 de media
    ])]);
    await uno("select guardar_recetas('forever', 'Alchemy', $1::jsonb)", [JSON.stringify([
      receta(2330, "Minor Healing Potion", 118, [[2447, 1], [3371, 1]]),
    ])]);
    await uno("select guardar_recetas('forever', 'Tailoring', $1::jsonb)", [JSON.stringify([
      receta(2963, "Bolt of Linen Cloth", 2996, [[2589, 2]]),
      receta(3914, "Brown Linen Pants", 4343, [[2996, 2]]),
      // Ciclo artificial: deshacer el rollo devuelve tela. No debe colgar ni abaratar nada.
      receta(99999, "Unbolt", 2589, [[2996, 1]], 2, 2),
    ])]);
    await escaneo("2026-11-10T10:00:00Z", [
      [2770, 100, 120],        // mineral
      [2840, 500, 450],        // barra en subasta más cara que fundir (100)
      [2880, null, 400],       // flux sin ofertas: valor de mercado
      [2447, 20, 25],
      [118, 300, 100],         // compra mínima muy por encima del valor de mercado → tope 150 %
      [2589, 10, 10],
      [2996, 50, 50],          // rollo en subasta más caro que fabricarlo (2 × 10)
      [4343, null, 1000],      // sin ofertas: se valora por su valor de mercado
    ]);
  });

  test("material: fabricarlo si sale más barato (y en cadena), con el origen indicado", async () => {
    const r = (await objeto(2880)).fabricacion[0];
    assert.equal(r.reactivos[0].id, 2840);
    assert.equal(r.reactivos[0].origen, "fabricar");
    assert.equal(r.reactivos[0].subasta, 500);
    assert.equal(r.reactivos[0].fabricar, 100);
    assert.equal(r.coste, 100);
    assert.equal(r.resultado.precio, 400);            // sin compra mínima: valor de mercado
    assert.equal(r.resultado.fuente_valor, "valor_mercado");
    assert.equal(Number(r.bruto), 800);              // × 2 de rendimiento medio
    // Pantalones: rollo fabricado (2 × 10 = 20) en vez de comprado (50); el ciclo «Unbolt» no cambia nada.
    const p = (await objeto(4343)).fabricacion[0];
    assert.equal(p.reactivos[0].origen, "fabricar");
    assert.equal(p.coste, 40);
  });

  test("iconos del catálogo para el producto y los materiales (V8); sin icono conocido, null", async () => {
    const ICONO = "https://render.worldofwarcraft.com/classic1x-us/icons/56/inv_misc_flux.jpg";
    await pg.query("update catalogo set icono_url = $1 where item_id in (2880, 2840)", [ICONO]);
    const r = (await uno("select recetas_profesion($1, 'Blacksmithing', 'tsm') as r", [TSM])).r.recetas[0];
    assert.equal(r.resultado.icono, ICONO);
    assert.equal(r.reactivos[0].icono, ICONO);
    const m = (await uno("select recetas_profesion($1, 'Mining', 'tsm') as r", [TSM])).r.recetas[0];
    assert.equal(m.reactivos[0].icono, null);      // mineral sin icono en ningún sitio: no se inventa
    assert.equal(m.coste, 100);                     // el cálculo no cambia
  });

  test("las bases de siempre siguen igual", async () => {
    const r = (await objeto(2880, "mediana")).fabricacion[0];
    assert.equal(r.reactivos[0].coste, 450);          // valor de mercado, sin buscar alternativas
    assert.equal(r.reactivos[0].origen, undefined);
    await assert.rejects(objeto(2880, "otra"), /Base de precio no válida/);
  });

  test("sin precio de un material: incompleto; con el precio de compra al NPC introducido: completo", async () => {
    let r = (await objeto(118)).fabricacion[0];
    assert.equal(r.completa, false);
    assert.deepEqual(r.faltan, ["#3371"]);          // nombre que da la receta en esta prueba
    assert.equal(r.coste, null);
    // Vista previa: no guarda nada.
    const prev = await importar([{ id: 3371, precio: 4 }], false);
    assert.equal(prev.aceptadas.length, 1);
    assert.equal(Number((await uno("select count(*) as n from precios_npc")).n), 0);
    await importar([{ id: 3371, precio: 4 }]);
    r = (await objeto(118)).fabricacion[0];
    assert.equal(r.completa, true);
    const vial = r.reactivos.find((x: any) => x.id === 3371);
    assert.equal(vial.origen, "npc");
    assert.equal(vial.npc_tuyo, true);
    assert.equal(r.coste, 24);
    // Valor del producto: compra mínima 300 > 150 % de 100 → se usa el tope (150).
    assert.equal(r.resultado.precio, 150);
    assert.equal(r.resultado.tope_aplicado, true);
    // Sin tope (0): la compra mínima tal cual.
    await pg.exec("update settings set value = '0' where key = 'recetas.tope_valor_pct'");
    assert.equal((await objeto(118)).fabricacion[0].resultado.precio, 300);
    // La ficha lo muestra como introducido por ti.
    const f = (await uno("select ficha_objeto($1, 3371) as r", [TSM])).r;
    assert.equal(f.compra_npc, 4);
    assert.equal(f.compra_npc_origen, "usuario");
  });

  test("importación verificable: rechaza lo que no cuadra y deja borrar", async () => {
    const r = await importar([{ id: 3371, precio: 1 }, { id: 123456, precio: 5 }, { id: 2589, precio: 0 },
                              { id: "x", precio: 3 }, { id: 2589, precio: 7 }]);
    assert.deepEqual(r.aceptadas.map((x: any) => x.id), [2589]);
    assert.deepEqual(r.rechazadas.map((x: any) => x.fila), [1, 2, 3, 4]);
    assert.match(r.rechazadas[0].motivo, /no es plausible/);
    assert.match(r.rechazadas[1].motivo, /catálogo/);
    assert.equal(r.guardados, 1);
    const l = (await uno("select listar_compra_npc($1) as r", [TSM])).r;
    assert.deepEqual(l.map((x: any) => [x.id, x.precio]), [[2589, 7]]);
    await importar([{ id: 2589, precio: null }]);
    assert.equal((await uno("select listar_compra_npc($1) as r", [TSM])).r.length, 0);
  });
});
