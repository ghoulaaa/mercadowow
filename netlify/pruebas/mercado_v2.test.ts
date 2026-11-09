// V2 (plan V3): tabla del Mercado paginada sobre TODO el catálogo, con estados basados en pruebas.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { paginas, paramsMercado, segmentosSpark, TRAMO_SPARK_MS } from "../../app/static/mercado.js";
import { crearApi, type Db } from "../lib/api.ts";

const AHL = "ahledger:forever:us:pvp-horde";
const DEMO = "demo:forever:us:demo";

describe("parámetros y minigráfico (sin DOM)", () => {
  test("solo se envían los filtros con valor", () => {
    assert.deepEqual(paramsMercado({ texto: "  ma ", categoria: "", calidad: "RARE", soloOfertas: false, orden: "nombre", dir: "asc", pagina: 1 }),
      { q: "ma", calidad: "RARE", orden: "nombre", dir: "asc" });
    assert.deepEqual(paramsMercado({ categoria: "Weapon", subcategoria: "Sword", precio_min: 100, precio_max: null, nivel_min: 0, soloOfertas: true, pagina: 3 }),
      { categoria: "Weapon", subcategoria: "Sword", precio_min: "100", nivel_min: "0", solo_ofertas: "true", pagina: "3" });
    // Subcategoría sin categoría no tiene sentido; precio negativo o decimal no se envía.
    assert.deepEqual(paramsMercado({ subcategoria: "Sword", precio_min: -5, nivel_max: 1.5 }), {});
  });
  test("número de páginas", () => {
    assert.equal(paginas(0), 1);
    assert.equal(paginas(100), 1);
    assert.equal(paginas(5042), 51);
  });
  test("minigráfico: corta donde falta un tramo de 6 h (periodo sin escaneos)", () => {
    const t = (k: number) => k * TRAMO_SPARK_MS;
    assert.deepEqual(segmentosSpark([[t(0), 10], [t(1), 12], [t(3), 9], [t(4), null], [t(5), 8]]),
      [[[t(0), 10], [t(1), 12]], [[t(3), 9]], [[t(5), 8]]]);
    assert.deepEqual(segmentosSpark([]), []);
  });
});

describe("mercado_pagina (SQL)", () => {
  let pg: PGlite;
  let db: Db;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const pagina = async (p: object = {}, m = AHL) => (await uno("select mercado_pagina($1, $2::jsonb) as r", [m, JSON.stringify(p)])).r;
  const ESCANEO = "2026-11-09T18:28:30Z";

  async function snapshot(hora: string, filas: [number, number | null, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [AHL, hora]);
    for (const [id, min, cant] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [AHL, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, quantity, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $4::bigint, $5::integer, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [AHL, id, hora, min, cant]);
    }
  }

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0014_tasas.sql", "0015_recetas.sql",
                     "0017_mercado_pagina.sql"]) await pg.exec(leer(n));
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
    // Catálogo de 4 objetos reales (forma de AHledger /v1/items).
    const cat = [
      { id: 2589, name: "Linen Cloth", quality: "COMMON", itemClass: "Trade Goods", itemSubclass: "Cloth", level: 5 },
      { id: 2592, name: "Wool Cloth", quality: "COMMON", itemClass: "Trade Goods", itemSubclass: "Cloth", level: 15 },
      { id: 19019, name: "Thunderfury, Blessed Blade of the Windseeker", quality: "LEGENDARY", itemClass: "Weapon", itemSubclass: "Sword", level: 80 },
      { id: 8831, name: "Purple Lotus", quality: "COMMON", itemClass: "Trade Goods", itemSubclass: "Herb", level: 42 },
    ];
    await uno("select guardar_catalogo('forever', $1::jsonb, 'ahledger', $2::timestamptz)", [JSON.stringify(cat), ESCANEO]);
    // Hace 24 h: Linen a 20c y Wool a 100c. Ahora: Linen a 25c; Wool ya no está; Thunderfury nunca se vio.
    await snapshot("2026-11-08T18:10:00Z", [[2589, 20, 1000], [2592, 100, 5], [8831, 2480, 300]]);
    await snapshot(ESCANEO, [[2589, 25, 1200], [8831, 2300, 310]]);
  });

  test("recorre TODO el catálogo con estados basados en pruebas; un precio desconocido es null", async () => {
    const r = await pagina();
    assert.equal(r.total, 4);
    assert.equal(r.total_catalogo, 4);
    const por = Object.fromEntries(r.filas.map((f: any) => [f.id, f]));
    assert.deepEqual([por[2589].estado, por[2589].precio, por[2589].cantidad, Number(por[2589].var24)], ["con_ofertas", 25, 1200, 25]);
    assert.deepEqual([por[2592].estado, por[2592].precio, por[2592].ultimo_precio], ["sin_ofertas", null, 100]);
    assert.deepEqual([por[19019].estado, por[19019].precio, por[19019].visto], ["sin_datos", null, null]);
    assert.equal(por[2589].spark.length, 2);   // dos tramos de 6 h con observaciones
  });

  test("filtros: texto sin tildes, ID, categoría, calidad, nivel, precio y solo con ofertas", async () => {
    assert.deepEqual((await pagina({ q: "CLOTH" })).filas.map((f: any) => f.id), [2589, 2592]);
    assert.deepEqual((await pagina({ q: "thunder blade" })).filas.map((f: any) => f.id), [19019]);
    assert.deepEqual((await pagina({ q: "2589" })).filas.map((f: any) => f.id), [2589]);
    assert.deepEqual((await pagina({ categoria: "Trade Goods", subcategoria: "Herb" })).filas.map((f: any) => f.id), [8831]);
    assert.deepEqual((await pagina({ calidad: "LEGENDARY" })).filas.map((f: any) => f.id), [19019]);
    assert.deepEqual((await pagina({ nivel_min: "10", nivel_max: "50" })).filas.map((f: any) => f.id), [8831, 2592]);
    assert.deepEqual((await pagina({ precio_max: "100" })).filas.map((f: any) => f.id), [2589]);   // sin precio → fuera
    assert.equal((await pagina({ solo_ofertas: true })).total, 2);
  });

  test("los contadores del árbol respetan los demás filtros, no la categoría elegida", async () => {
    const r = await pagina({ categoria: "Weapon", solo_ofertas: false });
    assert.equal(r.total, 1);
    assert.deepEqual(r.categorias.map((c: any) => [c.categoria, c.n]), [["Trade Goods", 3], ["Weapon", 1]]);
    assert.deepEqual(r.categorias[0].subcategorias, [{ subcategoria: "Cloth", n: 2 }, { subcategoria: "Herb", n: 1 }]);
    const ofertas = await pagina({ solo_ofertas: true });
    assert.deepEqual(ofertas.categorias.map((c: any) => [c.categoria, c.n]), [["Trade Goods", 2]]);
  });

  test("orden con desconocidos al final y paginación", async () => {
    const asc = (await pagina({ orden: "precio", dir: "asc" })).filas.map((f: any) => f.precio);
    assert.deepEqual(asc.slice(0, 2), [25, 2300]);
    assert.deepEqual(asc.slice(2), [null, null]);
    const desc = (await pagina({ orden: "precio", dir: "desc" })).filas.map((f: any) => f.precio);
    assert.deepEqual(desc, [2300, 25, null, null]);
    const p2 = await pagina({ por_pagina: "3", pagina: "2" });
    assert.deepEqual([p2.total, p2.filas.length, p2.pagina], [4, 1, 2]);
    assert.equal((await pagina({ orden: "nombre", dir: "desc" })).filas[0].nombre, "Wool Cloth");
  });

  test("profesión relacionada: resultado o material de sus recetas", async () => {
    await uno(`select guardar_recetas('forever', 'Alchemy', $1::jsonb)`, [JSON.stringify([{
      spell_id: 1, nombre: "X", nivel_requerido: 1, obtencion: "trainer", resultado_id: 2592, resultado_nombre: "Wool Cloth",
      cantidad_min: 1, cantidad_max: 1, reactivos: [{ item_id: 8831, nombre: "Purple Lotus", cantidad: 1 }] }])]);
    assert.deepEqual((await pagina({ profesion: "Alchemy" })).filas.map((f: any) => f.id), [8831, 2592]);
    assert.deepEqual((await pagina()).profesiones, ["Alchemy"]);
  });

  test("el mercado ficticio solo muestra sus propios objetos", async () => {
    await uno("select generar_demo(5, $1::timestamptz)", [ESCANEO]);
    const r = await pagina({}, DEMO);
    assert.equal(r.total_catalogo, 16);
    assert.ok(r.filas.every((f: any) => f.nombre.startsWith("[FICTICIO]")));
  });

  for (const [nombre, p, patron] of [
    ["orden no válido", { orden: "x" }, /Orden no válido/],
    ["dirección no válida", { dir: "arriba" }, /Dirección no válida/],
    ["página no numérica", { pagina: "abc" }, /no es un número/],
    ["página 0", { pagina: "0" }, /1 o más/],
    ["demasiadas filas", { por_pagina: "500" }, /entre 1 y 200/],
    ["profesión desconocida", { profesion: "Fishing" }, /desconocida/],
  ] as const) {
    test(`rechaza: ${nombre}`, async () => assert.rejects(pagina(p), patron));
  }

  test("ficha: estado y hora del escaneo", async () => {
    const f = async (id: number) => (await uno("select ficha_objeto($1, $2) as r", [AHL, id])).r;
    assert.equal((await f(2589)).estado, "con_ofertas");
    assert.equal((await f(2592)).estado, "sin_ofertas");
    assert.equal((await f(19019)).estado, "sin_datos");
    assert.equal((await f(19019)).mercado, null);
  });

  test("API /api/mercado: sesión, validación y parámetros", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: AHL, proyecto: "p" });
    assert.equal((await api.mercado(new Request("https://x/api/mercado"))).status, 401);
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const get = (q: string) => api.mercado(new Request(`https://x/api/mercado${q}`, { headers: { cookie } }));
    assert.equal((await get("?solo_ofertas=quizas")).status, 400);
    assert.equal((await get("?orden=x")).status, 422);
    const r = await (await get("?q=cloth&solo_ofertas=true&parametro_raro=1")).json();
    assert.deepEqual(r.filas.map((f: any) => f.id), [2589]);
  });
});
