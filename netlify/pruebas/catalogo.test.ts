// Catálogo (R2): guardar, buscar, ficha, categorías, completar por lotes y alta por ID.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { completarCatalogo } from "../../supabase/functions/actualizar-mercado/nucleo.ts";
import { filtrar, prepararFilas, subcategorias } from "../../app/static/tabla.js";
import { crearApi, type Db } from "../lib/api.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const AHL = "ahledger:forever:us:pvp-horde", DEMO = "demo:forever:us:demo", TSM = "tsm:forever:us:pvp-horde";
const AHORA = "2026-11-08T08:00:00Z";

// Respuesta REAL de AHledger /v1/items/7082?game=forever (2026-11-08).
const ESENCIA = {
  id: 7082, name: "Essence of Air", quality: "UNCOMMON", itemClass: "Trade Goods", itemSubclass: "Elemental",
  level: 55, requiredLevel: null, vendorSell: 400,
  icon: "https://render.worldofwarcraft.com/classic1x-us/icons/56/spell_nature_earthbind.jpg",
  url: "https://ahledger.com/items/7082-essence-of-air?utm_source=ahledger_api&utm_medium=api&utm_campaign=items",
};
const obj = (id: number, name: string, extra: object = {}) => ({
  id, name, quality: "COMMON", itemClass: "Trade Goods", itemSubclass: "Cloth", level: 5, requiredLevel: null,
  vendorSell: 10, icon: `https://render.worldofwarcraft.com/classic1x-us/icons/56/x${id}.jpg`, url: `https://ahledger.com/items/${id}`, ...extra,
});

let pg: PGlite;
let db: Db;
const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
const guardar = (items: object[]) => uno("select guardar_catalogo('forever', $1::text::jsonb, 'ahledger', $2::timestamptz) as r",
  [JSON.stringify(items), AHORA]);
const buscar = async (q: string, mk = AHL) => (await uno("select buscar_catalogo($1, $2, 20) as r", [mk, q])).r as any[];

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated;");
  await pg.exec(leer("0001_esquema.sql"));
  await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
  for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                   "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0012_busqueda_mercado.sql"]) await pg.exec(leer(n));
  db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
});

describe("guardar y buscar", () => {
  test("guarda los datos reales de Essence of Air con su procedencia", async () => {
    assert.equal((await guardar([ESENCIA])).r, 1);
    const c = await uno("select * from catalogo where item_id = 7082");
    assert.equal(c.nombre, "Essence of Air");
    assert.equal(c.calidad, "UNCOMMON");
    assert.equal(c.clase, "Trade Goods");
    assert.equal(c.subclase, "Elemental");
    assert.equal(c.nivel, 55);
    assert.equal(c.nivel_requerido, null);
    assert.equal(Number(c.venta_npc), 400);          // 4 platas, no 4 oros
    assert.equal(c.wowhead_url, "https://www.wowhead.com/forever/item=7082");
    assert.equal(c.fuente_url, "https://ahledger.com/items/7082-essence-of-air");   // sin parámetros de seguimiento
    assert.equal(c.fuente, "ahledger");
  });

  test("icono de otro dominio: se guarda el objeto sin icono", async () => {
    await guardar([obj(1, "X", { icon: "https://evil.example.com/x.jpg" })]);
    assert.equal((await uno("select icono_url from catalogo where item_id = 1")).icono_url, null);
  });

  test("búsqueda: ID exacto, prefijo antes que contiene, sin mayúsculas ni tildes", async () => {
    await guardar([ESENCIA, obj(2589, "Linen Cloth"), obj(4306, "Silk Cloth"), obj(7076, "Essence of Earth"),
                   obj(14047, "Runecloth"), obj(9999, "Clothier's Kit")]);
    assert.deepEqual((await buscar("7082")).map((r) => r.id), [7082]);
    assert.deepEqual((await buscar("ESSENCE")).map((r) => r.nombre), ["Essence of Air", "Essence of Earth"]);
    assert.deepEqual((await buscar("éssence of a")).map((r) => r.id), [7082]);
    const cloth = (await buscar("cloth")).map((r) => r.nombre);
    assert.equal(cloth[0], "Clothier's Kit");           // empieza por «cloth»
    assert.ok(cloth.includes("Linen Cloth") && cloth.includes("Runecloth"));
    assert.deepEqual(await buscar("%"), []);             // % no es un comodín
    assert.deepEqual(await buscar(""), []);
    assert.deepEqual(await buscar("zzz"), []);
  });

  test("mientras el catálogo se completa, encuentra los objetos del mercado sin ficha (sin duplicarlos)", async () => {
    await uno("select guardar_metadatos($1, $2::jsonb)", [AHL, JSON.stringify([
      { item_id: 7076, name: "Essence of Earth" }, { item_id: 7082, name: "Essence of Air" }])]);
    await guardar([ESENCIA]);    // solo 7082 tiene ficha
    const r = await buscar("essence");
    assert.deepEqual(r.map((x) => x.id), [7082, 7076]);
    assert.equal(r[0].subclase, "Elemental");
    assert.equal(r[1].subclase, null);
    assert.ok(r.every((x) => x.en_mercado));
    assert.deepEqual((await buscar("essence", TSM)).map((x) => x.id), [7082]);   // en TSM solo el del catálogo
  });

  test("en el demo solo busca sus objetos ficticios", async () => {
    await guardar([ESENCIA]);
    await uno("select generar_demo(1, now())");
    const r = await buscar("hierba", DEMO);
    assert.ok(r.length > 0 && r.every((x) => x.nombre.startsWith("[FICTICIO]")));
  });

  test("marca si el objeto tiene precio en el mercado elegido", async () => {
    await guardar([ESENCIA]);
    await uno("select guardar_metadatos($1, $2::jsonb)", [AHL, JSON.stringify([{ item_id: 7082, name: "Essence of Air" }])]);
    assert.equal((await buscar("7082"))[0].en_mercado, true);
    assert.equal((await buscar("7082", TSM))[0].en_mercado, false);
  });
});

describe("metadatos en los mercados", () => {
  test("el catálogo rellena los objetos de los mercados reales, nunca del demo", async () => {
    await uno("select generar_demo(1, now())");
    await uno("select guardar_metadatos($1, $2::jsonb)", [AHL, JSON.stringify([{ item_id: 2589, name: "Linen Cloth" }])]);
    await guardar([obj(2589, "Linen Cloth"), obj(900001, "Algo real con ID de demo")]);
    const i = await uno("select item_class, item_subclass, vendor_price, quality from items i join markets m on m.id = i.market_id where m.key = $1 and item_id = 2589", [AHL]);
    assert.deepEqual([i.item_class, i.item_subclass, Number(i.vendor_price), i.quality], ["Trade Goods", "Cloth", 10, "COMMON"]);
    const d = await uno("select name, item_subclass from items i join markets m on m.id = i.market_id where m.is_demo and item_id = 900001");
    assert.equal(d.name, "[FICTICIO] Hierba de prueba");
    assert.equal(d.item_subclass, null);
  });

  test("objetos nuevos de un mercado toman los metadatos del catálogo si ya existen", async () => {
    await guardar([ESENCIA]);
    await uno("select guardar_metadatos($1, $2::jsonb)", [AHL, JSON.stringify([{ item_id: 7082, name: "Essence of Air" }])]);
    const i = await uno("select item_subclass, vendor_price from items where item_id = 7082");
    assert.equal(i.item_subclass, "Elemental");
    assert.equal(Number(i.vendor_price), 400);
  });

  test("categorías reales clase › subclase con recuento", async () => {
    await guardar([ESENCIA, obj(2589, "Linen Cloth"), obj(4306, "Silk Cloth")]);
    await uno("select guardar_metadatos($1, $2::jsonb)", [AHL, JSON.stringify([
      { item_id: 7082, name: "Essence of Air" }, { item_id: 2589, name: "Linen Cloth" }, { item_id: 4306, name: "Silk Cloth" },
      { item_id: 5, name: "Sin catálogo" }])]);
    const c = (await uno("select categorias_mercado($1) as r", [AHL])).r;
    assert.deepEqual(c, [
      { clase: "Trade Goods", n: 3, subclases: [{ subclase: "Cloth", n: 2 }, { subclase: "Elemental", n: 1 }] },
      { clase: "Sin clasificar", n: 1, subclases: [] },
    ]);
  });
});

describe("ficha del objeto", () => {
  test("con catálogo y sin precio: «sin datos de mercado», nunca un precio inventado", async () => {
    await guardar([ESENCIA]);
    const f = (await uno("select ficha_objeto($1, 7082) as r", [AHL])).r;
    assert.equal(f.en_catalogo, true);
    assert.equal(f.en_mercado, false);
    assert.equal(f.mercado, null);
    assert.equal(f.venta_npc, 400);
    assert.equal(f.wowhead_url, "https://www.wowhead.com/forever/item=7082");
  });

  test("inexistente: null; demo: sin enlace a Wowhead", async () => {
    assert.equal((await uno("select ficha_objeto($1, 123456) as r", [AHL])).r, null);
    await uno("select generar_demo(1, now())");
    const d = (await uno("select ficha_objeto($1, 900001) as r", [DEMO])).r;
    assert.equal(d.wowhead_url, null);
    assert.equal(d.en_catalogo, false);
  });
});

describe("completar el catálogo por lotes", () => {
  const preparar = async (ids: number[]) => uno("select guardar_metadatos($1, $2::jsonb)",
    [AHL, JSON.stringify(ids.map((id) => ({ item_id: id, name: `Objeto #${id}`, fuente: "pendiente" })))]);

  test("pide los pendientes, guarda los encontrados y anota los que no existen", async () => {
    await preparar([7082, 2589, 404404]);
    const pedidas: string[] = [];
    const f = (async (url: string) => {
      pedidas.push(url);
      const id = Number(url.match(/items\/(\d+)/)![1]);
      if (id === 7082) return Response.json(ESENCIA);
      if (id === 2589) return Response.json(obj(2589, "Linen Cloth"));
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const r = await completarCatalogo(db, { fetch: f, ahora: () => new Date(AHORA) });
    assert.deepEqual(r, { estado: "ok", pedidos: 3, guardados: 2, sin_datos: 1, parado: null });
    assert.ok(pedidas.every((u) => u.startsWith("https://api.ahledger.com/v1/items/") && u.endsWith("?game=forever")));
    assert.equal((await uno("select count(*)::int n from catalogo")).n, 2);
    // Ya no quedan pendientes (el 404 no se reintenta en 7 días).
    assert.deepEqual((await uno("select catalogo_pendientes('forever', 100, $1::timestamptz) as r", [AHORA])).r, []);
    assert.equal((await uno("select name from items where item_id = 2589")).name, "Objeto #2589");  // el nombre del mercado no se toca
  });

  test("un 429 detiene el lote sin marcar nada como inexistente", async () => {
    await preparar([1, 2, 3, 4, 5, 6, 7, 8]);
    const r = await completarCatalogo(db, {
      fetch: (async () => new Response("lento", { status: 429 })) as typeof fetch, ahora: () => new Date(AHORA),
    });
    assert.equal(r.parado, "HTTP 429");
    assert.equal(r.sin_datos, 0);
    assert.equal((await uno("select count(*)::int n from catalogo_fallos")).n, 0);
  });

  test("dos lotes a la vez: el segundo no hace nada", async () => {
    await preparar([1]);
    assert.equal((await uno("select tomar_turno_catalogo(180, $1::timestamptz) as r", [AHORA])).r, true);
    const r = await completarCatalogo(db, { fetch: (async () => Response.json(obj(1, "X"))) as typeof fetch, ahora: () => new Date(AHORA) });
    assert.deepEqual(r, { estado: "omitido", motivo: "en_curso" });
  });

  test("el demo no genera pendientes", async () => {
    await uno("select generar_demo(1, now())");
    assert.deepEqual((await uno("select catalogo_pendientes('forever', 100) as r")).r, []);
  });
});

describe("API: buscar, ficha, categorías y alta por ID", () => {
  test("alta por ID al buscar un número que no está; demo nunca pide a AHledger", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const pedidas: string[] = [];
    const f = (async (url: string) => { pedidas.push(url); return url.includes("/7082") ? Response.json(ESENCIA) : new Response("", { status: 404 }); }) as typeof fetch;
    const api = crearApi(db, { clave: CLAVE, mercado: AHL, proyecto: "p", fetch: f, ahora: () => new Date(AHORA) });
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const get = (ruta: string, c = true) => new Request("https://x" + ruta, { headers: c ? { cookie } : {} });

    assert.equal((await api.catalogo(get("/api/catalogo?q=7082", false))).status, 401);
    const b = await (await api.catalogo(get("/api/catalogo?q=7082"))).json();
    assert.equal(b.resultados[0].nombre, "Essence of Air");
    assert.equal(pedidas.length, 1);
    await api.catalogo(get("/api/catalogo?q=7082"));
    assert.equal(pedidas.length, 1);                      // ya está: no se vuelve a pedir

    const ficha = await (await api.objeto(get("/api/objeto?id=7082"))).json();
    assert.equal(ficha.subclase, "Elemental");
    assert.equal((await api.objeto(get("/api/objeto?id=555"))).status, 404);
    assert.equal((await api.objeto(get("/api/objeto?id=abc"))).status, 400);

    await uno("select generar_demo(1, now())");
    const antes = pedidas.length;
    await api.objeto(get(`/api/objeto?mercado=${DEMO}&id=123`));
    assert.equal(pedidas.length, antes);

    const cats = await (await api.categorias(get("/api/categorias"))).json();
    assert.ok(Array.isArray(cats));
  });
});

describe("filtros de la tabla", () => {
  test("subcategorías reales y filtro por calidad", () => {
    const filas = prepararFilas([
      { id: 1, nombre: "A", categoria: "Trade Goods", subcategoria: "Cloth", calidad: "COMMON", precio: 1 },
      { id: 2, nombre: "B", categoria: "Trade Goods", subcategoria: "Elemental", calidad: "UNCOMMON", precio: 1 },
      { id: 3, nombre: "C", categoria: "Armor", subcategoria: "Cloth", calidad: "UNCOMMON", precio: 1 },
    ]);
    assert.deepEqual(subcategorias(filas, "Trade Goods"), ["Cloth", "Elemental"]);
    assert.deepEqual(subcategorias(filas, ""), []);
    assert.deepEqual(filtrar(filas, { categoria: "Trade Goods", subcategoria: "Cloth" }).map((f) => f.id), [1]);
    assert.deepEqual(filtrar(filas, { calidad: "UNCOMMON" }).map((f) => f.id), [2, 3]);
  });
});
