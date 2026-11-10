// Cantidades disponibles en TSM (que no las publica): las del último escaneo de AHledger del mismo reino.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const TSM = "tsm:forever:us:pvp-horde";
const AHL = "ahledger:forever:us:pvp-horde";

describe("cantidades de AHledger en el mercado TSM (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const pagina = async (mk: string, p: object = {}) => (await uno("select mercado_pagina($1, $2::jsonb) as r", [mk, JSON.stringify(p)])).r;
  const fila = async (mk: string, id: number, p: object = {}) => (await pagina(mk, p)).filas.find((x: any) => x.id === id);

  // [id, compra mínima, cantidad]
  async function escaneo(mk: string, hora: string, filas: [number, number | null, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [mk, hora]);
    for (const [id, min, q] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [mk, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, quantity, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, 100, $5::integer, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [mk, id, hora, min, q]);
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
                     "0039_cantidades_ahledger.sql"]) await pg.exec(leer(n));
    const cat = [[2589, "Linen Cloth"], [2840, "Copper Bar"], [765, "Silverleaf"]]
      .map(([id, name]) => ({ id, name, itemClass: "Trade Goods", itemSubclass: "Cloth", quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await escaneo(TSM, "2026-11-10T18:00:00Z", [[2589, 200, null], [2840, 500, null], [765, 50, null]]);
    // AHledger: 2589 con 8.921 unidades; 2840 sin ofertas (0 unidades); 765 no aparece.
    await escaneo(AHL, "2026-11-10T21:30:00Z", [[2589, 190, 8921], [2840, null, 0]]);
  });

  test("TSM muestra la cantidad de AHledger, marcada y con la hora de su escaneo", async () => {
    const p = await pagina(TSM);
    assert.equal(p.cantidad_fuente.proveedor, "AHledger");
    assert.equal(new Date(p.cantidad_fuente.escaneo).toISOString(), "2026-11-10T21:30:00.000Z");
    const a = await fila(TSM, 2589);
    assert.deepEqual([a.cantidad, a.cantidad_ref, a.precio], [8921, true, 200]);   // el precio sigue siendo el de TSM
    const b = await fila(TSM, 2840);
    assert.deepEqual([b.cantidad, b.cantidad_ref], [null, false]);   // 0 unidades en AHledger: sin dato, no «0»
    assert.equal((await fila(TSM, 765)).cantidad, null);
    // Ordenar por cantidad usa esas cifras.
    const orden = (await pagina(TSM, { orden: "cantidad", dir: "desc" })).filas.map((x: any) => x.id);
    assert.equal(orden[0], 2589);
  });

  test("AHledger usa sus propias cantidades (sin marca de referencia)", async () => {
    const p = await pagina(AHL);
    assert.equal(p.cantidad_fuente, null);
    const a = await fila(AHL, 2589);
    assert.deepEqual([a.cantidad, a.cantidad_ref], [8921, false]);
  });

  test("detalle y versión: la cantidad de AHledger en la ficha y la versión cambia con cada escaneo suyo", async () => {
    const f = (await uno("select ficha_objeto($1, 2589) as r", [TSM])).r;
    assert.equal(f.cantidad_ref.cantidad, 8921);
    assert.equal(f.cantidad_ref.proveedor, "AHledger");
    assert.equal((await uno("select ficha_objeto($1, 765) as r", [TSM])).r.cantidad_ref, null);
    assert.equal((await uno("select ficha_objeto($1, 2589) as r", [AHL])).r.cantidad_ref, null);
    const v1 = (await uno("select version_mercado($1) as r", [TSM])).r.cantidades;
    await escaneo(AHL, "2026-11-10T22:30:00Z", [[2589, 185, 9000]]);
    const v2 = (await uno("select version_mercado($1) as r", [TSM])).r.cantidades;
    assert.notEqual(v1, v2);
    assert.equal((await fila(TSM, 2589)).cantidad, 9000);
  });
});
