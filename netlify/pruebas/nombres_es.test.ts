// Nombres oficiales en español (API de Blizzard): guardado, búsqueda en los dos idiomas e importación por lotes.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { actualizarNombresEs, actualizarNombresEsExtra, type Db } from "../../supabase/functions/actualizar-mercado/nucleo.ts";

const TSM = "tsm:forever:us:pvp-horde";

describe("nombres en español", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const db: Db = { consulta: async (q, p) => (await pg.query<any>(q, p as unknown[])).rows };
  const ahora = () => new Date("2026-11-10T12:00:00Z");

  /** API de Blizzard simulada: token, objeto de control y nombres es_MX. */
  function blizzard(o: { tokenStatus?: number; controlEn?: string; nombres?: Record<number, string>; caida?: boolean;
                     error500?: number[]; extra?: Record<string, Record<number, { en: string; es: string }>> } = {}) {
    const pedidas: string[] = [];
    const f = (async (url: string) => {
      pedidas.push(url);
      if (url.startsWith("https://oauth.battle.net/token")) {
        return o.tokenStatus && o.tokenStatus !== 200 ? new Response("", { status: o.tokenStatus })
          : Response.json({ access_token: "t0k3n" });
      }
      const m = url.match(/\/data\/wow\/item\/(\d+)\?namespace=([^&]+)&locale=(\w+)/)!;
      const id = Number(m[1]), ns = m[2], locale = m[3];
      if (ns !== "static-classic1x-us") {
        const x = o.extra?.[ns]?.[id];
        return x ? Response.json({ id, name: locale === "en_US" ? x.en : x.es }) : new Response("", { status: 404 });
      }
      if (o.caida) return new Response("", { status: 503 });
      if (locale === "en_US") return id === 2589 ? Response.json({ id, name: o.controlEn ?? "Linen Cloth" }) : new Response("", { status: 404 });
      if ((o.error500 ?? []).includes(id)) return new Response("", { status: 500 });
      const n = (o.nombres ?? {})[id];
      return n ? Response.json({ id, name: n }) : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    return { f, pedidas };
  }

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0012_busqueda_mercado.sql",
                     "0013_textos_fuente.sql", "0014_tasas.sql", "0015_recetas.sql", "0017_mercado_pagina.sql",
                     "0018_evidencia.sql", "0019_catalogo_ampliado.sql", "0020_precios_tsm.sql", "0023_catalogo_informe.sql",
                     "0033_nombres_es.sql", "0035_nombres_es_errores.sql", "0036_nombres_es_extra.sql"]) await pg.exec(leer(n));
    const cat = [[2589, "Linen Cloth"], [2840, "Copper Bar"], [99001, "New Forever Item"]]
      .map(([id, name]) => ({ id, name, itemClass: "Trade Goods", itemSubclass: "Cloth", quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
  });

  test("sin credenciales no pide nada y se pausa unas horas", async () => {
    const { f, pedidas } = blizzard();
    assert.deepEqual(await actualizarNombresEs(db, { fetch: f, ahora }), { estado: "omitido", motivo: "sin_credenciales" });
    assert.equal(pedidas.length, 0);
    assert.ok(new Date((await uno("select value from settings where key = 'nombres_es_turno_hasta'")).value) > ahora());
  });

  test("credenciales rechazadas o espacio de datos que no coincide: no guarda nada", async () => {
    let r = await actualizarNombresEs(db, { fetch: blizzard({ tokenStatus: 401 }).f, clientId: "a", secreto: "b", ahora });
    assert.equal(r.motivo, "credenciales_rechazadas");
    await pg.exec("update settings set value = '-infinity' where key = 'nombres_es_turno_hasta'");
    r = await actualizarNombresEs(db, { fetch: blizzard({ controlEn: "Otra cosa", nombres: { 2589: "Tela de lino" } }).f,
      clientId: "a", secreto: "b", ahora });
    assert.equal(r.motivo, "ningun_espacio_de_datos_coincide");
    assert.equal(Number((await uno("select count(nombre_es) as n from catalogo")).n), 0);
  });

  test("guarda los nombres oficiales; los que Blizzard no tiene siguen en inglés y no se repiten en 30 días", async () => {
    const { f } = blizzard({ nombres: { 2589: "Tela de lino", 2840: "Barra de cobre" } });
    const r = await actualizarNombresEs(db, { fetch: f, clientId: "a", secreto: "b", ahora });
    assert.equal(r.estado, "ok");
    assert.equal((r as any).guardados, 2);
    assert.equal((r as any).sin_nombre, 1);
    assert.equal((r as any).espacio, "static-classic1x-us");
    const c = (await uno("select nombre, nombre_es, nombre_es_fuente, busqueda from catalogo where item_id = 2589")).valueOf();
    assert.deepEqual([c.nombre, c.nombre_es, c.nombre_es_fuente], ["Linen Cloth", "Tela de lino", "blizzard:static-classic1x-us:es_MX"]);
    assert.equal(c.busqueda, "tela de lino · linen cloth");
    // El catálogo puede volver a guardarse desde AHledger: el nombre en español se conserva y se sigue buscando.
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify([{ id: 2589, name: "Linen Cloth", itemClass: "Trade Goods" }])]);
    assert.equal((await uno("select busqueda from catalogo where item_id = 2589")).busqueda, "tela de lino · linen cloth");
    // Búsqueda en los dos idiomas.
    const buscar = async (q: string) => (await uno("select buscar_catalogo($1, $2) as r", [TSM, q])).r.map((x: any) => x.id);
    assert.deepEqual(await buscar("tela de"), [2589]);
    assert.deepEqual(await buscar("linen"), [2589]);
    // Para la página.
    assert.deepEqual((await uno("select nombres_es($1) as r", [TSM])).r, { 2589: "Tela de lino", 2840: "Barra de cobre" });
    // Al día: el que Blizzard no tiene no se vuelve a pedir hasta dentro de 30 días.
    assert.deepEqual((await uno("select nombres_es_pendientes('forever', 10, $1::timestamptz) as r", ["2026-11-20T00:00:00Z"])).r, []);
    assert.deepEqual((await uno("select nombres_es_pendientes('forever', 10, $1::timestamptz) as r", ["2026-12-15T00:00:00Z"])).r, [99001]);
    const e = (await uno("select nombres_es_estado('forever') as r")).r;
    assert.deepEqual([e.total, e.con_nombre, e.sin_nombre_en_blizzard, e.pendientes], [3, 2, 1, 0]);
  });

  test("un objeto con error 500 se salta (sin frenar a los demás) y se reintenta al cabo de ~1 día", async () => {
    const { f, pedidas } = blizzard({ nombres: { 2589: "Tela de lino", 99001: "Objeto nuevo" }, error500: [2840] });
    const r: any = await actualizarNombresEs(db, { fetch: f, clientId: "a", secreto: "b", ahora });
    assert.deepEqual([r.estado, r.guardados, r.con_error, r.parado], ["ok", 2, 1, null]);
    assert.equal(pedidas.filter((u) => u.includes("/item/2840")).length, 2);   // un reintento
    assert.equal((await uno("select value from settings where key = 'nombres_es_turno_hasta'")).value, "-infinity");   // sin pausa
    assert.deepEqual((await uno("select nombres_es_pendientes('forever', 10, $1::timestamptz) as r", ["2026-11-10T13:00:00Z"])).r, []);
    assert.deepEqual((await uno("select nombres_es_pendientes('forever', 10, $1::timestamptz) as r", ["2026-11-11T13:00:00Z"])).r, [2840]);
  });

  test("segunda pasada: objetos nuevos de Forever solo si el nombre en inglés coincide", async () => {
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify([{ id: 99002, name: "Another New Item", itemClass: "Armor" }])]);
    await actualizarNombresEs(db, { fetch: blizzard({ nombres: { 2589: "Tela de lino", 2840: "Barra de cobre" } }).f, clientId: "a", secreto: "b", ahora });
    const { f } = blizzard({ extra: {
      "static-classic-us": { 99002: { en: "Some Other Item", es: "Otro objeto distinto" } },   // mismo ID, otro objeto
      "static-us": { 99001: { en: "New Forever Item", es: "Objeto nuevo de Forever" } },
    } });
    const r: any = await actualizarNombresEsExtra(db, { fetch: f, clientId: "a", secreto: "b", ahora });
    assert.deepEqual([r.estado, r.guardados, r.sin_nombre, r.parado], ["ok", 1, 1, null]);
    const c = await uno("select nombre_es, nombre_es_fuente from catalogo where item_id = 99001");
    assert.deepEqual([c.nombre_es, c.nombre_es_fuente], ["Objeto nuevo de Forever", "blizzard:static-us:es_MX"]);
    assert.equal((await uno("select nombre_es from catalogo where item_id = 99002")).nombre_es, null);
    assert.deepEqual((await uno("select nombres_es_pendientes_extra('forever', 10, $1::timestamptz) as r", ["2026-11-12T00:00:00Z"])).r, []);
    assert.equal((await uno("select nombres_es_estado('forever') as r")).r.pendientes_extra, 0);
  });

  test("si la API se cae a mitad, se para, guarda lo que tenga y se pausa", async () => {
    const r = await actualizarNombresEs(db, { fetch: blizzard({ caida: true }).f, clientId: "a", secreto: "b", ahora });
    assert.equal(r.estado, "error");   // falla ya en el objeto de control
    assert.ok(new Date((await uno("select value from settings where key = 'nombres_es_turno_hasta'")).value) > ahora());
  });
});
