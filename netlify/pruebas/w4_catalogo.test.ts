// W4 (plan V4): iconos permitidos, objetos sin ficha en la fuente e informe del catálogo.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { TEXTO_SIN_FICHA, sinFicha } from "../../app/static/mercado.js";

const TSM = "tsm:forever:us:pvp-horde";

test("página: reconoce los objetos sin ficha por su nombre «#ID»", () => {
  assert.equal(sinFicha("#216483"), true);
  assert.equal(sinFicha("Linen Cloth"), false);
  assert.equal(sinFicha("#1 Fan"), false);
  assert.equal(TEXTO_SIN_FICHA, "Sin ficha en la fuente");
});

describe("catálogo e iconos (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const guardar = (items: object[]) => uno("select guardar_catalogo('forever', $1::jsonb) as r", [JSON.stringify(items)]);

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                     "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql",
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0022_mapa.sql", "0023_catalogo_informe.sql"]) await pg.exec(leer(n));
  });

  test("iconos: Blizzard y los de AHledger (/icons/<número>); cualquier otro dominio se descarta", async () => {
    await guardar([
      { id: 2589, name: "Linen Cloth", itemClass: "Trade Goods", icon: "https://render.worldofwarcraft.com/classic1x-us/icons/56/inv_fabric_linen_01.jpg" },
      { id: 249431, name: "Viridian Dye", itemClass: "Trade Goods", icon: "https://ahledger.com/icons/237062.jpg" },
      { id: 3, name: "Otro", itemClass: "Trade Goods", icon: "https://otro.example/icons/1.jpg" },
      { id: 4, name: "Truco", itemClass: "Trade Goods", icon: "https://ahledger.com/icons/../x.jpg" },
    ]);
    const ic = async (id: number) => (await uno("select icono_url from catalogo where item_id = $1", [id])).icono_url;
    assert.match(await ic(2589), /^https:\/\/render\.worldofwarcraft\.com\//);
    assert.equal(await ic(249431), "https://ahledger.com/icons/237062.jpg");
    assert.equal(await ic(3), null);
    assert.equal(await ic(4), null);
    await assert.rejects(pg.query("update catalogo set icono_url = 'https://otro.example/x.jpg' where item_id = 2589"), /check/);
  });

  test("objeto sin ficha: «Item N» sin clase no es un nombre → «#N», marcado, al final del orden y localizable por ID", async () => {
    await guardar([{ id: 216483, name: "Item 216483" }, { id: 2589, name: "Linen Cloth", itemClass: "Trade Goods" }]);
    const r = await uno("select nombre, sin_ficha, busqueda from catalogo where item_id = 216483");
    assert.deepEqual([r.nombre, r.sin_ficha], ["#216483", true]);
    assert.equal((await uno("select sin_ficha from catalogo where item_id = 2589")).sin_ficha, false);
    // Si la fuente publica después su ficha real, deja de estar marcado.
    await guardar([{ id: 216483, name: "Sandworm Scale", itemClass: "Trade Goods", quality: "COMMON" }]);
    assert.deepEqual(Object.values(await uno("select nombre, sin_ficha from catalogo where item_id = 216483")), ["Sandworm Scale", false]);
    await guardar([{ id: 216484, name: "Item 216484" }]);
    const pagina = (await uno("select mercado_pagina($1, '{}'::jsonb) as r", [TSM])).r;
    assert.equal(pagina.filas.at(-1).nombre, "#216484");      // al final del orden A–Z
    const busca = (await uno("select buscar_catalogo($1, '216484') as r", [TSM])).r;
    assert.deepEqual(busca.map((x: any) => x.nombre), ["#216484"]);
  });

  test("los nombres provisionales de los mercados también se guardan por su ID", async () => {
    await uno("insert into items (market_id, item_id, name) select id, 284717, 'Item 284717' from markets where key = $1", [TSM]);
    assert.equal((await uno("select name from items where item_id = 284717")).name, "#284717");
  });

  test("informe por categoría: totales, iconos, sin ficha, precio TSM, duplicados y errores", async () => {
    await guardar([
      { id: 2589, name: "Linen Cloth", itemClass: "Trade Goods", quality: "COMMON", icon: "https://render.worldofwarcraft.com/a.jpg" },
      { id: 249431, name: "Viridian Dye", itemClass: "Trade Goods", quality: "UNCOMMON", icon: "https://ahledger.com/icons/237062.jpg" },
      { id: 19019, name: "Thunderfury", itemClass: "Weapon", quality: "LEGENDARY" },
      { id: 216483, name: "Item 216483" },
    ]);
    await uno("select registrar_fallo_catalogo('forever', array[999999], 'AHledger no tiene este objeto')");
    await uno(`insert into snapshots (market_id, source_updated_at, row_count) select id, '2026-11-09T19:16:24Z', 1 from markets where key = $1`, [TSM]);
    await uno(`insert into items (market_id, item_id, name) select id, 2589, 'Linen Cloth' from markets where key = $1`, [TSM]);
    await uno(`insert into price_hourly (market_id, item_id, hour, min_buyout, snapshot_id)
               select m.id, 2589, '2026-11-09T19:00:00Z', 26, s.id from markets m join snapshots s on s.market_id = m.id where m.key = $1`, [TSM]);
    const i = (await uno("select informe_catalogo('forever') as r")).r;
    assert.deepEqual([i.total, i.ids_unicos, i.duplicados, i.sin_ficha], [4, 4, 0, 1]);
    assert.deepEqual(i.iconos, { blizzard: 1, ahledger: 1, sin_icono: 2, sin_icono_con_ficha: 1, archivos_distintos: 2 });
    assert.deepEqual(i.precios_tsm, { vistos: 1, con_ofertas_ultimo_escaneo: 1 });
    assert.deepEqual(i.errores, [{ motivo: "AHledger no tiene este objeto", n: 1 }]);
    const tg = i.por_categoria.find((x: any) => x.categoria === "Trade Goods");
    assert.deepEqual([tg.total, tg.icono_blizzard, tg.icono_ahledger, tg.visto_tsm], [2, 1, 1, 1]);
    assert.equal(i.por_categoria.at(-1).categoria, "Sin clasificar");
  });
});
