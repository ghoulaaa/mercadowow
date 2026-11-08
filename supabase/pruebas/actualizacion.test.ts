// Pruebas de la actualización horaria con un Postgres real en memoria (PGlite).
// Se aplica la migración 0001 tal cual; la 0002 (pg_cron, pg_net) es exclusiva de Supabase.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  ejecutar, leerArchivoTsm, parsearCsv, ErrorFormato, type Db,
} from "../functions/actualizar-mercado/nucleo.ts";

const MIGRACION = readFileSync(new URL("../../db/migraciones/0001_esquema.sql", import.meta.url), "utf8");
const MK = "tsm:forever:us:pvp-horde";
const CAB = "itemId,name,marketValue,minBuyout,recent,historical,updatedAt";

const csv = (updatedAt: string, filas: string[]) =>
  [CAB, ...filas.map((f) => `${f},${updatedAt}`)].join("\n") + "\n";

const CSV_A = csv("2026-11-07T22:16:24Z", [
  "14183,Watcher's Leggings,4130,3500,3500,4900",
  '7287,"Red Whelp Scale, the ""big"" one",8050,7500,7500,9900',
  "1933,Staff of Conjuring,3150,,21400,5000",
]);
const CSV_B = csv("2026-11-08T01:10:00Z", [
  "14183,Watcher's Leggings,4200,3600,3600,4900",
  "7287,Red Whelp Scale,8100,7600,7600,9900",
]);

// ---------- utilidades de prueba ----------

let pg: PGlite;
let db: Db;
let reloj: Date;
const ahora = () => new Date(reloj);
const avanzar = (min: number) => { reloj = new Date(reloj.getTime() + min * 60_000); };

type Respuesta = { status: number; body?: string; headers?: Record<string, string> } | Error;
let cola: Respuesta[];
let pedidas: { url: string; headers: Record<string, string> }[];

const fetchFalso = (async (url: string, init?: RequestInit) => {
  pedidas.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
  const r = cola.shift();
  if (!r) throw new Error("La prueba no preparó respuesta");
  if (r instanceof Error) throw r;
  return new Response(r.status === 304 ? null : (r.body ?? ""), { status: r.status, headers: r.headers });
}) as typeof fetch;

const correr = (extra: Partial<Parameters<typeof ejecutar>[1]> = {}) =>
  ejecutar(db, { mercado: MK, fetch: fetchFalso, ahora, ...extra });

const uno = async (sql: string, p: unknown[] = []) => (await pg.query<Record<string, any>>(sql, p)).rows[0];
const estado = () => uno(
  "select s.* from fetch_state s join markets m on m.id = s.market_id where m.key = $1", [MK]);
const contar = async (tabla: string) => Number((await uno(`select count(*)::int as n from ${tabla}`)).n);
const minutosHasta = (t: Date) => Math.round((new Date(t).getTime() - reloj.getTime()) / 60_000);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec("set time zone 'America/Santiago'"); // a propósito ≠ UTC
  await pg.exec(MIGRACION);
  db = { consulta: async (q, p) => (await pg.query<Record<string, unknown>>(q, p)).rows };
  reloj = new Date("2026-11-07T23:00:00Z");
  cola = [];
  pedidas = [];
});

// ---------- CSV ----------

describe("lectura del CSV de TSM", () => {
  test("comillas, comas dentro de campos, CRLF y BOM", () => {
    assert.deepEqual(parsearCsv('﻿a,"b,c","d""e"\r\n1,2,3\r\n'), [["a", "b,c", 'd"e'], ["1", "2", "3"]]);
  });

  test("convierte precios en cobre y deja vacío como null", () => {
    const a = leerArchivoTsm(CSV_A);
    assert.equal(a.updatedAt, "2026-11-07T22:16:24.000Z");
    const bastón = a.filas.find((f) => f.item_id === 1933)!;
    assert.equal(bastón.min_buyout, null);
    assert.equal(bastón.market_value, 3150);
    assert.equal(a.filas.find((f) => f.item_id === 7287)!.name, 'Red Whelp Scale, the "big" one');
  });

  test("objeto repetido: se queda la última fila", () => {
    const a = leerArchivoTsm(csv("2026-11-07T22:16:24Z", ["1,X,10,10,10,10", "1,X,20,20,20,20"]));
    assert.equal(a.filas.length, 1);
    assert.equal(a.filas[0].market_value, 20);
    assert.equal(a.duplicadas, 1);
  });

  for (const [nombre, texto] of [
    ["columnas cambiadas", "itemId,name,price,updatedAt\n1,X,5,2026-11-07T22:16:24Z\n"],
    ["precio decimal", csv("2026-11-07T22:16:24Z", ["1,X,10.5,10,10,10"])],
    ["precio negativo", csv("2026-11-07T22:16:24Z", ["1,X,-10,10,10,10"])],
    ["fila incompleta", CAB + "\n1,X,10\n"],
    ["sin filas", CAB + "\n"],
    ["updatedAt mezclado", CAB + "\n1,X,1,1,1,1,2026-11-07T22:16:24Z\n2,Y,1,1,1,1,2026-11-07T23:00:00Z\n"],
  ] as const) {
    test(`rechaza: ${nombre}`, () => assert.throws(() => leerArchivoTsm(texto), ErrorFormato));
  }
});

// ---------- flujo completo contra Postgres ----------

describe("actualización horaria", () => {
  test("primera descarga guarda observaciones con la hora del dato original", async () => {
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"', "Last-Modified": "Sat, 07 Nov 2026 22:18:47 GMT" } });
    const r = await correr();
    assert.equal(r.estado, "nuevo_dato");
    assert.equal(pedidas[0].url, "https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv");
    assert.equal(await contar("snapshots"), 1);
    assert.equal(await contar("price_hourly"), 3);
    const fila = await uno("select hour, min_buyout from price_hourly where item_id = 14183");
    assert.equal(new Date(fila.hour).toISOString(), "2026-11-07T22:00:00.000Z"); // hora UTC, no la local
    assert.equal(Number(fila.min_buyout), 3500);
    const s = await estado();
    assert.equal(s.etag, '"v1"');
    assert.equal(minutosHasta(s.next_attempt_at), 60);
    assert.equal(s.lease_run_id, null);
  });

  test("antes de 60 minutos no se vuelve a consultar al proveedor", async () => {
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    await correr();
    avanzar(30);
    const r = await correr();
    assert.equal(r.estado, "omitido");
    assert.equal(r.detalle.motivo, "no_toca");
    assert.equal(pedidas.length, 1);
  });

  test("304 No modificado: se envía el ETag y NO se crea observación", async () => {
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"', "Last-Modified": "Sat, 07 Nov 2026 22:18:47 GMT" } });
    await correr();
    avanzar(61);
    cola.push({ status: 304 });
    const r = await correr();
    assert.equal(r.estado, "no_modificado");
    assert.equal(pedidas[1].headers["If-None-Match"], '"v1"');
    assert.equal(pedidas[1].headers["If-Modified-Since"], "Sat, 07 Nov 2026 22:18:47 GMT");
    assert.equal(await contar("snapshots"), 1);
    assert.equal(await contar("price_hourly"), 3);
    const s = await estado();
    assert.equal(new Date(s.last_success_at).getTime(), reloj.getTime());
  });

  test("ETag nuevo pero mismo escaneo original: no es un precio nuevo", async () => {
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    await correr();
    avanzar(61);
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v2"' } });
    const r = await correr();
    assert.equal(r.estado, "sin_cambios");
    assert.equal(await contar("snapshots"), 1);
    assert.equal((await estado()).etag, '"v2"');
  });

  test("dato nuevo se añade sin borrar el anterior", async () => {
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    await correr();
    avanzar(180);
    cola.push({ status: 200, body: CSV_B, headers: { ETag: '"v2"' } });
    assert.equal((await correr()).estado, "nuevo_dato");
    assert.equal(await contar("snapshots"), 2);
    assert.equal(await contar("price_hourly where item_id = 14183"), 2);
  });

  test("archivo más antiguo que el último guardado se ignora", async () => {
    cola.push({ status: 200, body: CSV_B, headers: { ETag: '"v2"' } });
    await correr();
    avanzar(61);
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    assert.equal((await correr()).estado, "sin_cambios");
    assert.equal(await contar("snapshots"), 1);
  });

  test("fallo de conexión: conserva el último dato y reintenta con espera creciente", async () => {
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    await correr();
    const datoAntes = (await estado()).last_source_updated_at;

    avanzar(61);
    cola.push(new Error("getaddrinfo ENOTFOUND"));
    const r1 = await correr();
    assert.equal(r1.estado, "error");
    let s = await estado();
    assert.equal(s.consecutive_failures, 1);
    assert.equal(minutosHasta(s.next_attempt_at), 5);
    assert.match(s.last_error, /ENOTFOUND/);
    assert.deepEqual(s.last_source_updated_at, datoAntes);   // último dato válido intacto
    assert.equal(await contar("price_hourly"), 3);

    avanzar(5);
    cola.push({ status: 500 });
    await correr();
    assert.equal(minutosHasta((await estado()).next_attempt_at), 10);

    avanzar(10);
    cola.push({ status: 502 });
    await correr();
    assert.equal(minutosHasta((await estado()).next_attempt_at), 20);

    avanzar(20);
    cola.push({ status: 304 });
    assert.equal((await correr()).estado, "no_modificado");
    s = await estado();
    assert.equal(s.consecutive_failures, 0);
    assert.equal(minutosHasta(s.next_attempt_at), 60);
    assert.equal(await contar("fetch_log where status = 'error'"), 3);
  });

  test("la espera de reintento nunca supera el intervalo normal", async () => {
    await pg.exec("update fetch_state set consecutive_failures = 20");
    cola.push({ status: 500 });
    await correr();
    assert.equal(minutosHasta((await estado()).next_attempt_at), 60);
  });

  test("respeta Retry-After del proveedor (429)", async () => {
    cola.push({ status: 429, headers: { "Retry-After": "1800" } });
    await correr();
    assert.equal(minutosHasta((await estado()).next_attempt_at), 30);
  });

  test("formato inesperado: error registrado y nada guardado", async () => {
    cola.push({ status: 200, body: "itemId,name,price\n1,X,5\n", headers: { ETag: '"raro"' } });
    const r = await correr();
    assert.equal(r.estado, "error");
    assert.match(String(r.detalle.mensaje), /Columnas inesperadas/);
    assert.equal(await contar("snapshots"), 0);
    assert.equal((await estado()).etag, null); // no se adopta el ETag de un archivo rechazado
  });

  test("dos ejecuciones simultáneas: solo una descarga", async () => {
    let soltar!: () => void;
    const espera = new Promise<void>((res) => { soltar = res; });
    const lenta = (async (url: string, init?: RequestInit) => {
      await espera;
      return fetchFalso(url, init);
    }) as typeof fetch;
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });

    const primera = correr({ fetch: lenta });
    await new Promise((r) => setTimeout(r, 50)); // la primera ya tiene el turno
    const segunda = await correr();
    assert.equal(segunda.estado, "omitido");
    assert.equal(segunda.detalle.motivo, "en_curso");
    soltar();
    assert.equal((await primera).estado, "nuevo_dato");
    assert.equal(pedidas.length, 1);
  });

  test("un turno colgado caduca y la ejecución vieja ya no puede escribir", async () => {
    const colgada = "00000000-0000-4000-8000-000000000001";
    await db.consulta("select tomar_turno($1, $2::uuid, $3::timestamptz) as r", [MK, colgada, ahora().toISOString()]);
    assert.equal((await correr()).detalle.motivo, "en_curso");
    avanzar(6); // turno de 5 min caducado
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    assert.equal((await correr()).estado, "nuevo_dato");
    await assert.rejects(
      db.consulta("select registrar_no_modificado($1, $2::uuid) as r", [MK, colgada]),
      /ya no es válido/);
  });
});

describe("separación de mercados", () => {
  test("el demo no tiene fuente y no se descarga", async () => {
    const r = await ejecutar(db, { mercado: "demo:forever:us:demo", fetch: fetchFalso, ahora });
    assert.equal(r.estado, "omitido");
    assert.equal(r.detalle.motivo, "mercado_sin_fuente");
    assert.equal(pedidas.length, 0);
  });

  test("un mercado no registrado (Alianza, Retail…) se rechaza", async () => {
    for (const mk of ["tsm:forever:us:pvp-alliance", "tsm:retail:us:area-52"]) {
      await assert.rejects(ejecutar(db, { mercado: mk, fetch: fetchFalso, ahora }), /Mercado desconocido/);
    }
  });

  test("los precios descargados quedan solo en el mercado PvP Horda", async () => {
    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    await correr();
    const r = await uno(
      "select count(*) filter (where m.key = $1)::int as horda, count(*)::int as total from price_hourly p join markets m on m.id = p.market_id",
      [MK]);
    assert.equal(r.horda, 3);
    assert.equal(r.total, 3);
  });

  test("un demo no puede tener URL de descarga", async () => {
    await assert.rejects(pg.exec(
      "insert into markets (key, provider, game_type, region, slug, label, is_demo, source_url) " +
      "values ('demo2','demo','forever','us','d2','x',true,'https://x')"), /demo_sin_fuente/);
  });
});

describe("botón de actualización manual", () => {
  test("protección contra pulsaciones repetidas y trabajo en curso", async () => {
    const pedir = async () => (await uno("select solicitar_actualizacion($1, $2::timestamptz) as r",
      [MK, ahora().toISOString()])).r;

    cola.push({ status: 200, body: CSV_A, headers: { ETag: '"v1"' } });
    await correr();                         // consulta automática ahora mismo
    avanzar(2);
    const r1 = await pedir();
    assert.equal(r1.ok, false);
    assert.equal(r1.motivo, "espera");
    assert.equal(r1.segundos, 180);

    avanzar(4);
    assert.equal((await pedir()).ok, true); // adelanta la próxima consulta
    assert.equal(minutosHasta((await estado()).next_attempt_at), 0);
    assert.equal((await pedir()).motivo, "espera"); // segunda pulsación inmediata

    cola.push({ status: 304 });
    assert.equal((await correr()).estado, "no_modificado");
  });
});
