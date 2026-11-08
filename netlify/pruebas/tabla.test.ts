// Tabla de precios: lógica del navegador (tabla.js) y SQL (0005) contra PGlite.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { categorias, filtrar, formatearPct, ordenar, prepararFilas, variacion } from "../../app/static/tabla.js";
import { crearApi, type Db } from "../lib/api.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const CSV = "csv:forever:us:pvp-horde", DEMO = "demo:forever:us:demo", TSM = "tsm:forever:us:pvp-horde";

describe("tabla.js", () => {
  const base = [
    { id: 1, nombre: "Mena de cobre", categoria: "Minerales", precio: 110, valor_mercado: 100, historico: 100, precio_24h: 100, precio_7d: null, favorito: true, ausente: false },
    { id: 2, nombre: "Hierba", categoria: null, precio: null, valor_mercado: 50, historico: 100, precio_24h: null, precio_7d: 100, favorito: false, ausente: false },
    { id: 3, nombre: "Tela", categoria: "Tela", precio: 90, valor_mercado: 95, historico: null, precio_24h: 100, precio_7d: 60, favorito: false, ausente: true },
  ];
  const filas = prepararFilas(base);

  test("variaciones: con dato, sin dato y división por cero", () => {
    assert.equal(variacion(110, 100), 10);
    assert.equal(variacion(90, 100), -10);
    assert.equal(variacion(null, 100), null);
    assert.equal(variacion(100, null), null);
    assert.equal(variacion(100, 0), null);
    assert.equal(filas[0].var24, 10);
    assert.equal(filas[0].var7, null);
    assert.equal(filas[2].var7, 50);
  });

  test("sin compra inmediata se usa el valor de mercado; sin categoría = «Sin clasificar»", () => {
    assert.equal(filas[1].precio_ref, 50);
    assert.equal(filas[1].vs_hist, -50);
    assert.equal(filas[1].categoria, "Sin clasificar");
    assert.deepEqual(categorias(filas), ["Minerales", "Tela", "Sin clasificar"]);
  });

  test("filtros: texto (varias palabras e ID), categoría, favoritos y ausentes", () => {
    assert.deepEqual(filtrar(filas, { texto: "mena cobre" }).map((f) => f.id), [1]);
    assert.deepEqual(filtrar(filas, { texto: "2" }).map((f) => f.id), [2]);
    assert.deepEqual(filtrar(filas, { categoria: "Tela" }).map((f) => f.id), [3]);
    assert.deepEqual(filtrar(filas, { soloFavoritos: true }).map((f) => f.id), [1]);
    assert.deepEqual(filtrar(filas, { ocultarAusentes: true }).map((f) => f.id), [1, 2]);
  });

  test("orden: los vacíos van al final en ambas direcciones", () => {
    assert.deepEqual(ordenar(filas, "var7", "desc").map((f) => f.id), [3, 2, 1]);
    assert.deepEqual(ordenar(filas, "var7", "asc").map((f) => f.id), [2, 3, 1]);
    assert.deepEqual(ordenar(filas, "precio", "desc").map((f) => f.id), [1, 3, 2]);
    assert.deepEqual(ordenar(filas, "nombre").map((f) => f.id), [2, 1, 3]);
    assert.deepEqual(ordenar(filas, "vs_hist", "asc").map((f) => f.id), [2, 1, 3]);
  });

  test("porcentajes", () => {
    assert.equal(formatearPct(12.345), "+12,3 %");
    assert.equal(formatearPct(-3), "−3,0 %");
    assert.equal(formatearPct(0), "0,0 %");
    assert.equal(formatearPct(null), "—");
  });
});

describe("tabla_precios (SQL)", () => {
  let pg: PGlite;
  let db: Db;
  const q = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const importar = (hora: string, filas: object[]) =>
    q("select importar_precios($1, $2::timestamptz, $3::text::jsonb, 'p.csv', '2026-12-31'::timestamptz) as r",
      [CSV, hora, JSON.stringify(filas)]);
  const fila = (id: number, precio: number) => ({ item_id: id, name: `Obj ${id}`, min_buyout: precio, market_value: precio + 5, historical: 1000 });
  const tabla = async (mk = CSV) => (await q("select tabla_precios($1) as r", [mk])).r as any[];

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql"]) await pg.exec(leer(n));
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
  });

  test("último precio y referencias de 24 h y 7 días solo si hay observación cercana", async () => {
    await importar("2026-11-01T10:00:00Z", [fila(1, 100), fila(2, 200)]);   // hace 7 días
    await importar("2026-11-07T09:00:00Z", [fila(1, 150), fila(2, 210)]);   // hace 25 h
    await importar("2026-11-08T10:00:00Z", [fila(1, 120), fila(2, 220)]);   // ahora
    const t = await tabla();
    const o1 = t.find((x) => x.id === 1);
    assert.equal(o1.precio, 120);
    assert.equal(o1.valor_mercado, 125);
    assert.equal(o1.historico, 1000);
    assert.equal(o1.precio_24h, 150);
    assert.equal(o1.precio_7d, 100);
    assert.equal(o1.ausente, false);
  });

  test("sin observación en la ventana: referencia vacía (no se inventa)", async () => {
    await importar("2026-11-05T10:00:00Z", [fila(1, 100)]);   // 3 días antes: fuera de ambas ventanas
    await importar("2026-11-08T10:00:00Z", [fila(1, 120)]);
    const [o] = await tabla();
    assert.equal(o.precio_24h, null);
    assert.equal(o.precio_7d, null);
  });

  test("objeto que no está en el último escaneo: marcado como ausente con su última hora", async () => {
    await importar("2026-11-07T10:00:00Z", [fila(1, 100), fila(2, 200)]);
    await importar("2026-11-08T10:00:00Z", [fila(1, 120)]);
    const o2 = (await tabla()).find((x) => x.id === 2);
    assert.equal(o2.ausente, true);
    assert.equal(o2.precio, 200);
    assert.equal(new Date(o2.hora).toISOString(), "2026-11-07T10:00:00.000Z");
  });

  test("favoritos por mercado: el mismo ID en otro mercado no se marca", async () => {
    await importar("2026-11-08T10:00:00Z", [fila(900001, 100)]);
    await q("select generar_demo(1, '2026-11-08T10:00:00Z'::timestamptz)");
    await q("select marcar_favorito($1, 900001, true)", [CSV]);
    assert.equal((await tabla(CSV))[0].favorito, true);
    assert.equal((await tabla(DEMO)).find((x) => x.id === 900001).favorito, false);
    await q("select marcar_favorito($1, 900001, false)", [CSV]);
    assert.equal((await tabla(CSV))[0].favorito, false);
    await assert.rejects(q("select marcar_favorito($1, 424242, true)", [CSV]), /no existe en este mercado/);
    await assert.rejects(q("select marcar_favorito('nada', 1, true)"), /desconocido/);
  });

  test("la tabla de un mercado nunca incluye objetos de otro", async () => {
    await importar("2026-11-08T10:00:00Z", [fila(1, 100)]);
    await q("select generar_demo(1, '2026-11-08T10:00:00Z'::timestamptz)");
    assert.deepEqual((await tabla(CSV)).map((x) => x.id), [1]);
    assert.ok((await tabla(DEMO)).every((x) => x.nombre.startsWith("[FICTICIO]")));
    assert.deepEqual(await tabla(TSM), []);
  });

  test("version_mercado cambia con datos nuevos y con favoritos", async () => {
    const v0 = (await q("select version_mercado($1) as r", [CSV])).r;
    await importar("2026-11-08T10:00:00Z", [fila(1, 100)]);
    const v1 = (await q("select version_mercado($1) as r", [CSV])).r;
    assert.notDeepEqual(v0, v1);
    await q("select marcar_favorito($1, 1, true)", [CSV]);
    const v2 = (await q("select version_mercado($1) as r", [CSV])).r;
    assert.equal(v2.favoritos, 1);
    assert.equal((await q("select version_mercado('nada') as r")).r, null);
  });

  test("API: precios, versión y favorito requieren sesión y validan", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: TSM, proyecto: "p" });
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const get = (ruta: string, c?: string) => new Request("https://x" + ruta, { headers: c ? { cookie: c } : {} });
    const post = (cuerpo: unknown, c?: string) => new Request("https://x/api/favorito",
      { method: "POST", body: JSON.stringify(cuerpo), headers: c ? { cookie: c } : {} });

    assert.equal((await api.precios(get("/api/precios"))).status, 401);
    assert.equal((await api.version(get("/api/version"))).status, 401);
    assert.equal((await api.favorito(post({}))).status, 401);

    await importar("2026-11-08T10:00:00Z", [fila(7, 700)]);
    const p = await (await api.precios(get(`/api/precios?mercado=${CSV}`, cookie))).json();
    assert.equal(p.mercado, CSV);
    assert.equal(p.objetos[0].precio, 700);
    assert.equal((await api.precios(get("/api/precios?mercado=nada", cookie))).status, 404);
    assert.equal((await api.favorito(post({ mercado: CSV, id: "7", favorito: true }, cookie))).status, 400);
    assert.equal((await api.favorito(post({ mercado: CSV, id: 7, favorito: true }, cookie))).status, 200);
    assert.equal((await api.favorito(post({ mercado: CSV, id: 8, favorito: true }, cookie))).status, 422);
    const v = await (await api.version(get(`/api/version?mercado=${CSV}`, cookie))).json();
    assert.equal(v.favoritos, 1);
  });
});
