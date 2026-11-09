// W1 (plan V4): precios TSM trazables. Un 0 de TSM no es un precio; métricas separadas y con nombre.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { formatearMoneda, parsearMoneda } from "../../app/static/moneda.js";
import { leerArchivoTsm } from "../../supabase/functions/actualizar-mercado/nucleo.ts";
import { crearApi, type Db } from "../lib/api.ts";

const TSM = "tsm:forever:us:pvp-horde";

test("conversión exacta: 1 oro = 100 platas = 10.000 cobres", () => {
  assert.equal(parsearMoneda("1o"), 10_000);
  assert.equal(parsearMoneda("1p"), 100);
  assert.equal(parsearMoneda("1o 1p 1c"), 10_101);
  assert.equal(formatearMoneda(10_000), "1o");
  assert.equal(formatearMoneda(10_101), "1o 1p 1c");
  assert.equal(formatearMoneda(26), "26c");
});

test("CSV de TSM: un 0 («sin anuncios») se guarda como null, nunca como precio 0", () => {
  // Filas reales del archivo de Forever US PvP Horda (09/11/2026 19:16 UTC).
  const csv = "itemId,name,marketValue,minBuyout,recent,historical,updatedAt\n" +
    "2589,Linen Cloth,24,26,26,25,2026-11-09T19:16:24Z\n" +
    "14425,Silksand Wraps,50000,0,0,50000,2026-11-09T19:16:24Z\n";
  const a = leerArchivoTsm(csv);
  assert.deepEqual(a.filas.find((f) => f.item_id === 2589),
    { item_id: 2589, name: "Linen Cloth", market_value: 24, min_buyout: 26, recent: 26, historical: 25 });
  assert.deepEqual(a.filas.find((f) => f.item_id === 14425),
    { item_id: 14425, name: "Silksand Wraps", market_value: 50000, min_buyout: null, recent: null, historical: 50000 });
});

describe("precios TSM en la base de datos", () => {
  let pg: PGlite;
  let db: Db;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const ANTES = ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
    "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
    "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql"];

  async function escaneo(hora: string, filas: [number, number | null, number | null][], importado = hora) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, fetched_at, row_count)
                    select id, $2::timestamptz, $3::timestamptz, 1 from markets where key = $1`, [TSM, hora, importado]);
    for (const [id, min, mv] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [TSM, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, recent, historical, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $5::bigint, $4::bigint, $5::bigint, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [TSM, id, hora, min, mv]);
    }
  }

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ANTES) await pg.exec(leer(n));
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
  });

  test("la migración corrige los 0 ya guardados de TSM (y solo de TSM)", async () => {
    await escaneo("2026-11-09T16:16:23Z", [[2589, 26, 24], [14425, 0, 50000]]);
    await pg.exec(leer("0020_precios_tsm.sql"));
    const r = await uno("select min_buyout, recent, market_value from price_hourly where item_id = 14425");
    assert.deepEqual([r.min_buyout, r.recent, Number(r.market_value)], [null, null, 50000]);
    assert.equal(Number((await uno("select min_buyout from price_hourly where item_id = 2589")).min_buyout), 26);
  });

  describe("con la migración 0020", () => {
    beforeEach(async () => { await pg.exec(leer("0020_precios_tsm.sql")); });

    test("mercado principal: TSM Forever US PvP Horda, con atribución", async () => {
      assert.equal((await uno("select mercado_principal() as r")).r, TSM);
      const e = (await uno("select estado_mercado($1) as r", [TSM])).r;
      assert.deepEqual(e.mercado.atribucion, { texto: "Precios: TradeSkillMaster (datos públicos)", url: "https://tradeskillmaster.com/public-data" });
    });

    test("la tabla muestra SOLO la compra mínima; sin anuncios = «Sin ofertas» con el valor de mercado aparte", async () => {
      await escaneo("2026-11-08T16:00:00Z", [[2589, 20, 22], [14425, 40000, 50000]]);
      await escaneo("2026-11-09T16:16:23Z", [[2589, 26, 24], [14425, null, 50000]]);
      const r = (await uno("select mercado_pagina($1, '{}'::jsonb) as r", [TSM])).r;
      const f = Object.fromEntries(r.filas.map((x: any) => [x.id, x]));
      assert.deepEqual([f[2589].estado, f[2589].precio, Number(f[2589].valor_mercado), Number(f[2589].var24)], ["con_ofertas", 26, 24, 30]);
      // 14425 está en el archivo pero sin compra mínima: no se usa su valor de mercado como precio.
      assert.deepEqual([f[14425].estado, f[14425].precio, Number(f[14425].valor_mercado), f[14425].ultimo_precio],
        ["sin_ofertas", null, 50000, 40000]);
      assert.equal(new Date(f[14425].visto).toISOString(), "2026-11-08T16:00:00.000Z");
      // El orden por precio no mezcla métricas: el objeto sin compra mínima va al final.
      const orden = (await uno(`select mercado_pagina($1, '{"orden":"precio","dir":"desc"}'::jsonb) as r`, [TSM])).r;
      assert.deepEqual(orden.filas.map((x: any) => x.id), [2589, 14425]);
    });

    test("ficha: cada métrica con nombre y significado, hora original y de importación", async () => {
      await escaneo("2026-11-09T16:16:23Z", [[2589, 26, 24]], "2026-11-09T16:30:01Z");
      const f = (await uno("select ficha_objeto($1, 2589) as r", [TSM])).r;
      assert.equal(f.proveedor, "tsm");
      assert.deepEqual(f.metricas.map((m: any) => [m.columna, m.clave_fuente, m.nombre]), [
        ["min_buyout", "minBuyout", "Compra mínima"], ["market_value", "marketValue", "Valor de mercado (TSM)"],
        ["recent", "recent", "Valor reciente (TSM)"], ["historical", "historical", "Precio histórico (TSM)"]]);
      assert.ok(f.metricas.every((m: any) => m.significado.length > 10 && m.url.startsWith("https://support.tradeskillmaster.com/")));
      assert.deepEqual([f.mercado.precio, Number(f.mercado.valor_mercado), f.estado], [26, 24, "con_ofertas"]);
      assert.equal(new Date(f.mercado.observado).toISOString(), "2026-11-09T16:16:23.000Z");
      assert.equal(new Date(f.mercado.importado).toISOString(), "2026-11-09T16:30:01.000Z");
    });

    test("API: sin mercado pedido, el estado es el de TSM", async () => {
      const CLAVE = "una-clave-larga-de-prueba";
      const api = crearApi(db, { clave: CLAVE, mercado: "ahledger:forever:us:pvp-horde", proyecto: "p" });
      const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const e = await (await api.estado(new Request("https://x/api/estado", { headers: { cookie } }))).json();
      assert.equal(e.mercado.clave, TSM);
      assert.equal(e.mercado_principal, TSM);
      const otro = await (await api.estado(new Request("https://x/api/estado?mercado=ahledger:forever:us:pvp-horde", { headers: { cookie } }))).json();
      assert.deepEqual([otro.mercado.clave, otro.mercado_principal], ["ahledger:forever:us:pvp-horde", TSM]);
    });
  });
});
