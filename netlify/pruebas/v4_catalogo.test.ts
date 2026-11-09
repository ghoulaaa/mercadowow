// V4 (plan V3): catálogo ampliado con recetas e importación verificable, y cobertura medida.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { leerIds } from "../../app/static/mercado.js";
import { completarCatalogo } from "../../supabase/functions/actualizar-mercado/nucleo.ts";
import { crearApi, type Db } from "../lib/api.ts";

const AHL = "ahledger:forever:us:pvp-horde";
const AHORA = "2026-11-09T20:00:00Z";

describe("leer IDs para importar", () => {
  test("lista con comas, espacios, saltos de línea, # y repetidos", () => {
    assert.deepEqual(leerIds("2589, 2592\n#19019 2589"), { ids: [2589, 2592, 19019], errores: [] });
  });
  test("enlaces de Wowhead", () => {
    assert.deepEqual(leerIds("https://www.wowhead.com/forever/item=19019/thunderfury\nhttps://www.wowhead.com/forever/item=2589").ids, [19019, 2589]);
  });
  test("CSV con cabecera: solo la columna del ID", () => {
    const r = leerIds("﻿nombre;itemId;precio\nLinen Cloth;2589;13\nWool;abc;5\n\nLotus;8831;2480");
    assert.deepEqual(r.ids, [2589, 8831]);
    assert.deepEqual(r.errores, ["Línea 3: «abc» no es un ID"]);
  });
  test("lo que no es un ID se informa, no se inventa", () => {
    const r = leerIds("2589 linen 0 -5 1234567890");
    assert.deepEqual(r.ids, [2589]);
    assert.equal(r.errores.length, 4);
  });
});

describe("cola y cobertura del catálogo (SQL)", () => {
  let pg: PGlite;
  let db: Db;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const pendientes = async () => (await uno("select catalogo_pendientes('forever', 100, $1::timestamptz) as r", [AHORA])).r;
  const cobertura = async () => (await uno("select cobertura_catalogo('forever', $1::timestamptz) as r", [AHORA])).r;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0014_tasas.sql", "0015_recetas.sql",
                     "0017_mercado_pagina.sql", "0019_catalogo_ampliado.sql"]) await pg.exec(leer(n));
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
    // 2589 se vio en la subasta; una receta usa 8831 para fabricar 12190 (nunca vistos en subasta).
    await uno(`insert into items (market_id, item_id, name) select id, 2589, 'Linen Cloth' from markets where key = $1`, [AHL]);
    await uno(`select guardar_recetas('forever', 'Alchemy', $1::jsonb)`, [JSON.stringify([{
      spell_id: 15833, nombre: "Dreamless Sleep Potion", nivel_requerido: 205, obtencion: "trainer", resultado_id: 12190,
      resultado_nombre: "Dreamless Sleep Potion", cantidad_min: 1, cantidad_max: 1,
      reactivos: [{ item_id: 8831, nombre: "Purple Lotus", cantidad: 3 }] }])]);
  });

  test("la cola incluye los objetos de las recetas, no solo los vistos en subasta", async () => {
    assert.deepEqual(await pendientes(), [2589, 8831, 12190]);
    const c = await cobertura();
    assert.deepEqual([c.catalogo, c.conocidos, c.pendientes], [0, 3, 3]);
    assert.deepEqual(c.por_origen, { mercado: 1, receta: 2, solo_receta: 2, importacion: 0 });
  });

  test("importación verificable: los IDs van a la cola; AHledger confirma o descarta cada uno", async () => {
    const r = (await uno("select solicitar_catalogo('forever', $1::integer[], $2::timestamptz) as r", [[19019, 2589, 19019, 0, 999999], AHORA])).r;
    assert.deepEqual([r.recibidos, r.validos, r.invalidos, r.nuevos_en_cola], [5, 3, 1, 3]);
    assert.deepEqual(await pendientes(), [2589, 8831, 12190, 19019, 999999]);

    // La Edge Function pide cada ID a AHledger: 999999 no existe (404) → no entra, queda como fallo.
    const pedidas: string[] = [];
    const falso = (async (url: string) => {
      pedidas.push(String(url));
      const id = Number(String(url).match(/items\/(\d+)/)![1]);
      if (id === 999999) return new Response("{}", { status: 404 });
      const nombres: Record<number, string> = { 2589: "Linen Cloth", 8831: "Purple Lotus", 12190: "Dreamless Sleep Potion", 19019: "Thunderfury, Blessed Blade of the Windseeker" };
      return new Response(JSON.stringify({ id, name: nombres[id], quality: "COMMON", itemClass: "Trade Goods" }), { status: 200 });
    }) as typeof fetch;
    const res: any = await completarCatalogo(db, { fetch: falso, ahora: () => new Date(AHORA) });
    assert.deepEqual([res.guardados, res.sin_datos], [4, 1]);
    assert.deepEqual(await pendientes(), []);
    const c = await cobertura();
    // Importados: 19019, 2589 y 999999 (este último pedido, pero sin ficha en la fuente).
    assert.deepEqual([c.catalogo, c.pendientes, c.sin_ficha_en_fuente, c.por_origen.importacion], [4, 0, 1, 3]);
    assert.equal((await uno("select count(*)::int n from catalogo where item_id = 999999")).n, 0);

    // Pedirlo otra vez a propósito lo vuelve a poner en la cola (aunque fallara hace poco).
    await uno("select solicitar_catalogo('forever', array[999999], $1::timestamptz)", [AHORA]);
    assert.deepEqual(await pendientes(), [999999]);
  });

  test("los objetos de recetas aparecen en la tabla del Mercado como «Sin datos»", async () => {
    await uno(`select guardar_catalogo('forever', $1::jsonb, 'ahledger', $2::timestamptz)`,
      [JSON.stringify([{ id: 8831, name: "Purple Lotus" }, { id: 12190, name: "Dreamless Sleep Potion" }]), AHORA]);
    const r = (await uno("select mercado_pagina($1, '{}'::jsonb) as r", [AHL])).r;
    assert.deepEqual(r.filas.map((f: any) => [f.id, f.estado]), [[12190, "sin_datos"], [2589, "sin_datos"], [8831, "sin_datos"]]);
  });

  for (const [nombre, ids, patron] of [["lista vacía", [], /ningún ID/], ["demasiados", Array.from({ length: 5001 }, (_, k) => k + 1), /máximo 5000/]] as const) {
    test(`rechaza: ${nombre}`, async () =>
      assert.rejects(uno("select solicitar_catalogo('forever', $1::integer[])", [ids]), patron));
  }

  test("API /api/cobertura: sesión y validación", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: AHL, proyecto: "p" });
    assert.equal((await api.cobertura(new Request("https://x/api/cobertura"))).status, 401);
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await (await api.cobertura(new Request("https://x/api/cobertura", { headers: { cookie } }))).json()).conocidos, 3);
    const post = (c: unknown) => api.cobertura(new Request("https://x/api/cobertura", { method: "POST", body: JSON.stringify(c), headers: { cookie } }));
    assert.equal((await post({ ids: ["2589"] })).status, 400);
    assert.equal((await post({ ids: [2 ** 40] })).status, 400);
    assert.equal((await post({})).status, 400);
    const ok = await (await post({ ids: [19019] })).json();
    assert.equal(ok.nuevos_en_cola, 1);
  });
});
