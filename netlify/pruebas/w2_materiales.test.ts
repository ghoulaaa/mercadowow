// W2 (plan V4): materiales de profesiones, familias y roles, desde recetas y clasificación oficial.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { NOMBRE_FAMILIA, paramsMercado } from "../../app/static/mercado.js";
import { NOMBRE_PROFESION } from "../../app/static/recetas.js";

const TSM = "tsm:forever:us:pvp-horde";

test("parámetros: rol solo con profesión; familia solo con materiales", () => {
  assert.deepEqual(paramsMercado({ profesion: "Alchemy", rol: "material" }), { profesion: "Alchemy", rol: "material" });
  assert.deepEqual(paramsMercado({ rol: "material" }), {});
  assert.deepEqual(paramsMercado({ materiales: true, familia: "hierbas" }), { materiales: "true", familia: "hierbas" });
  assert.deepEqual(paramsMercado({ materiales: false, familia: "hierbas" }), {});
});

test("nombres: Pesca y todas las familias tienen nombre en español", () => {
  assert.equal(NOMBRE_PROFESION.Fishing, "Pesca");
  for (const f of ["hierbas", "metales", "telas", "cueros", "encantamiento", "elementales", "cocina", "piezas",
                   "consumibles", "reactivos", "comercio_otros", "mision", "otros"]) assert.ok(NOMBRE_FAMILIA[f], f);
});

describe("relaciones y filtros (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const pagina = async (p: object = {}) => (await uno("select mercado_pagina($1, $2::jsonb) as r", [TSM, JSON.stringify(p)])).r;
  const ids = async (p: object) => (await pagina(p)).filas.map((f: any) => f.id).sort((a: number, b: number) => a - b);

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                     "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql",
                     "0020_precios_tsm.sql", "0021_materiales.sql"]) await pg.exec(leer(n));
    // Catálogo real (forma de AHledger /v1/items): clase y subclase oficiales.
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
    const receta = (spell: number, prof: string, res: number, mats: [number, number][], nivel = 1) => ({
      spell_id: spell, nombre: `R${spell}`, nivel_requerido: nivel, obtencion: "trainer", resultado_id: res,
      resultado_nombre: `P${res}`, cantidad_min: 1, cantidad_max: 1,
      reactivos: mats.map(([item_id, cantidad]) => ({ item_id, nombre: `M${item_id}`, cantidad })),
    });
    const guardar = (prof: string, l: unknown[]) => uno("select guardar_recetas('forever', $1, $2::jsonb)", [prof, JSON.stringify(l)]);
    await guardar("Mining", [receta(2657, "Mining", 2840, [[2770, 1]])]);                       // mena → barra
    await guardar("Blacksmithing", [receta(2660, "Blacksmithing", 2880, [[2840, 1]]), receta(3115, "Blacksmithing", 19019, [[2840, 6], [2589, 2]], 15)]);
    await guardar("First Aid", [receta(3275, "First Aid", 1530, [[2589, 1]])]);
    await guardar("Alchemy", [receta(2330, "Alchemy", 118, [[765, 1], [2589, 1]])]);
  });

  test("familias desde la subclase oficial; un material puede ser de varias profesiones sin duplicarse", async () => {
    const r = await pagina({ materiales: true });
    assert.equal(r.total, 4);                                    // 2770, 2840, 765, 2589 (sin repetir)
    assert.deepEqual(await ids({ materiales: true }), [765, 2589, 2770, 2840]);
    assert.deepEqual(r.familias, [{ familia: "hierbas", n: 1 }, { familia: "metales", n: 2 }, { familia: "telas", n: 1 }]);
    assert.deepEqual(await ids({ materiales: true, familia: "metales" }), [2770, 2840]);
  });

  test("profesión por rol: materiales, recetas (clase Recipe) y productos", async () => {
    assert.deepEqual(await ids({ profesion: "Blacksmithing", rol: "material" }), [2589, 2840]);
    assert.deepEqual(await ids({ profesion: "Blacksmithing", rol: "producto" }), [2880, 19019]);
    assert.deepEqual(await ids({ profesion: "Blacksmithing" }), [2589, 2840, 2880, 19019]);
    assert.deepEqual(await ids({ profesion: "Cooking", rol: "receta" }), [6661]);
    // Pesca: sin recetas en AHledger, pero existe por sus objetos de receta oficiales.
    assert.deepEqual(await ids({ profesion: "Fishing" }), [16083]);
  });

  test("contadores por profesión y rol, coherentes con la categoría elegida", async () => {
    const r = await pagina();
    const bs = r.profesiones_roles.find((p: any) => p.profesion === "Blacksmithing");
    assert.deepEqual([bs.n, bs.material, bs.receta, bs.producto], [4, 2, 0, 2]);
    assert.ok(r.profesiones_roles.some((p: any) => p.profesion === "Fishing" && p.receta === 1));
    const armas = await pagina({ categoria: "Weapon" });
    assert.deepEqual(armas.profesiones_roles.map((p: any) => [p.profesion, p.n]), [["Blacksmithing", 1]]);
    assert.equal(armas.materiales_total, 0);
    assert.ok(r.profesiones.includes("Fishing"));   // lista de nombres, compatible con páginas anteriores
    // Y la categoría cuenta respetando la profesión elegida.
    const herreria = await pagina({ profesion: "Blacksmithing" });
    assert.deepEqual(herreria.categorias.map((c: any) => [c.categoria, c.n]), [["Trade Goods", 3], ["Weapon", 1]]);
  });

  test("detalle: quién usa y quién fabrica cada objeto, con recetas y nivel", async () => {
    const barra = (await uno("select relaciones_objeto('forever', 2840) as r")).r;
    assert.equal(barra.familia, "metales");
    assert.deepEqual(barra.consumen, [{ profesion: "Blacksmithing", recetas: 2, nivel_min: 1 }]);
    assert.deepEqual(barra.producen, [{ profesion: "Mining", recetas: 1, nivel_min: 1 }]);
    const tela = (await uno("select relaciones_objeto('forever', 2589) as r")).r;
    assert.deepEqual(tela.consumen.map((c: any) => c.profesion), ["Alchemy", "Blacksmithing", "First Aid"]);
    assert.equal((await uno("select relaciones_objeto('forever', 16083) as r")).r.receta_de, "Fishing");
    const o = (await uno("select recetas_objeto($1, 2589) as r", [TSM])).r;
    assert.equal(o.relaciones.es_material, true);
  });

  for (const [nombre, p, patron] of [
    ["rol sin profesión", { rol: "material" }, /necesita una profesión/],
    ["rol no válido", { profesion: "Alchemy", rol: "herramienta" }, /Rol no válido/],
    ["familia desconocida", { materiales: true, familia: "rocas" }, /Familia desconocida/],
    ["profesión desconocida", { profesion: "Archaeology" }, /Profesión desconocida/],
  ] as const) {
    test(`rechaza: ${nombre}`, async () => assert.rejects(pagina(p), patron));
  }
});
