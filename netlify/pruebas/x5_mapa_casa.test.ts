// X5 (plan V5): mapa de toda la casa — clase › subclase › objetos, con la misma regla de variación.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { paramsMapaCasa, pesoGrupo } from "../../app/static/treemap.js";

const TSM = "tsm:forever:us:pvp-horde";

test("peso de un grupo: unidades si la fuente las da; si no, número de objetos", () => {
  assert.equal(pesoGrupo({ n: 7, cantidad: null }, "uniforme"), 7);
  assert.equal(pesoGrupo({ n: 7, cantidad: 120 }, "cantidad"), 120);
  assert.equal(pesoGrupo({ n: 7, cantidad: 0 }, "cantidad"), 0);
});

test("parámetros del mapa de la casa: la subclase solo con clase", () => {
  assert.deepEqual(paramsMapaCasa({ mercado: TSM, periodo: "24h" }), { mercado: TSM, ambito: "casa", periodo: "24h" });
  assert.deepEqual(paramsMapaCasa({ mercado: TSM, periodo: "3d", clase: "Weapon", subclase: "Sword", soloOfertas: true }),
    { mercado: TSM, ambito: "casa", periodo: "3d", clase: "Weapon", subclase: "Sword", solo_ofertas: "true" });
  assert.equal(paramsMapaCasa({ mercado: TSM, periodo: "24h", subclase: "Sword" }).subclase, undefined);
});

describe("mapa de la casa (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const mapa = async (p: object = {}) => (await uno("select mapa_casa($1, $2::jsonb) as r", [TSM, JSON.stringify(p)])).r;

  async function escaneo(hora: string, filas: [number, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [TSM, hora]);
    for (const [id, min] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [TSM, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, 100, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [TSM, id, hora, min]);
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
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0022_mapa.sql", "0029_mapa_casa.sql"]) await pg.exec(leer(n));
    const cat = [
      { id: 1, name: "Espada A", itemClass: "Weapon", itemSubclass: "Sword" },
      { id: 2, name: "Espada B", itemClass: "Weapon", itemSubclass: "Sword" },
      { id: 3, name: "Hacha", itemClass: "Weapon", itemSubclass: "Axe" },
      { id: 4, name: "Tela", itemClass: "Trade Goods", itemSubclass: "Cloth" },
      { id: 5, name: "Nunca vista", itemClass: "Trade Goods", itemSubclass: "Cloth" },
    ].map((x) => ({ ...x, quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await escaneo("2026-11-09T10:00:00Z", [[1, 100], [2, 100], [3, 100], [4, 100]]);
    await escaneo("2026-11-10T10:00:00Z", [[1, 110], [2, 130], [3, 90], [4, 100]]);
  });

  test("nivel 1: clases, tamaño por número de objetos y color por la mediana", async () => {
    const d = await mapa();
    assert.equal(d.nivel, "clases");
    assert.equal(d.tamano, "uniforme");     // TSM no publica cantidades
    assert.equal(d.total, 5);
    const w = d.grupos.find((g: any) => g.clave === "Weapon");
    assert.equal(w.n, 3);
    assert.equal(w.con_ofertas, 3);
    assert.equal(Number(w.variacion), 10);   // mediana de +10, +30, −10
    const t = d.grupos.find((g: any) => g.clave === "Trade Goods");
    assert.equal(t.n, 2);                    // la que nunca se ha visto cuenta, pero no inventa variación
    assert.equal(t.con_variacion, 1);
    assert.equal(Number(t.variacion), 0);
  });

  test("nivel 2 y 3: subclases y objetos; solo con ofertas quita los que no tienen", async () => {
    const s = await mapa({ clase: "Weapon" });
    assert.equal(s.nivel, "subclases");
    assert.deepEqual(s.grupos.map((g: any) => [g.clave, g.n]), [["Sword", 2], ["Axe", 1]]);
    assert.equal(Number(s.grupos[0].variacion), 20);
    const o = await mapa({ clase: "Weapon", subclase: "Sword" });
    assert.equal(o.nivel, "objetos");
    assert.deepEqual(o.objetos.map((x: any) => [x.id, x.variacion]), [[1, 10], [2, 30]]);
    assert.equal(o.objetos[0].precio_ref, 100);
    assert.equal((await mapa({ clase: "Trade Goods", subclase: "Cloth", solo_ofertas: true })).total, 1);
    await assert.rejects(mapa({ subclase: "Sword" }), /necesita una clase/);
    await assert.rejects(mapa({ periodo: "1h" }), /Periodo no válido/);
  });
});
