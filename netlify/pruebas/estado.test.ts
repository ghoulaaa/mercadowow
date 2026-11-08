// Pruebas de la función pública de Netlify con el esquema real (0001) en PGlite.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { leerEstado, refDeProyecto, type Db } from "../lib/estado.ts";

const MIGRACION = readFileSync(new URL("../../db/migraciones/0001_esquema.sql", import.meta.url), "utf8");
const MK = "tsm:forever:us:pvp-horde";

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(MIGRACION);
  db = { consulta: async (q, p) => (await pg.query<Record<string, unknown>>(q, p as unknown[])).rows };
});

test("mercado recién creado: solo lectura, sin versiones ni credenciales", async () => {
  const e = await leerEstado(db, MK, "abcd") as any;
  assert.equal(e.solo_lectura, true);
  assert.equal(e.mercado.clave, MK);
  assert.equal(e.mercado.nombre, "WoW Forever · US · PvP · Horda");
  assert.equal(e.actualizacion.versiones_guardadas, 0);
  assert.equal(e.actualizacion.configurada, false);
  assert.deepEqual(e.registro, []);
  assert.doesNotMatch(JSON.stringify(e), /postgres(ql)?:\/\//);
});

test("cuenta objetos y versiones como números y ordena el registro", async () => {
  await pg.exec(`
    insert into settings (key, value) values ('url_funcion', 'https://x.supabase.co/functions/v1/f');
    insert into items (market_id, item_id, name)
      select id, 1, 'A' from markets where key = '${MK}';
    insert into fetch_log (market_id, status, http_status, rows_received, message, started_at, finished_at)
      select id, 'no_modificado', 304, null::int, null::text,
             '2026-11-08T01:00:00Z'::timestamptz, '2026-11-08T01:00:01Z'::timestamptz from markets where key = '${MK}'
      union all
      select id, 'nuevo_dato', 200, 3728, null::text,
             '2026-11-08T02:00:00Z'::timestamptz, '2026-11-08T02:00:02Z'::timestamptz from markets where key = '${MK}';
  `);
  const e = await leerEstado(db, MK, "abcd") as any;
  assert.equal(e.actualizacion.configurada, true);
  assert.strictEqual(e.actualizacion.objetos, 1);
  assert.equal(e.registro.length, 2);
  assert.equal(e.registro[0].estado, "nuevo_dato");
  assert.equal(e.registro[0].hora, "2026-11-08T02:00:02Z");
});

test("otro mercado no mezcla datos de pvp-horde", async () => {
  const e = await leerEstado(db, "tsm:forever:us:pvp-alliance", "abcd") as any;
  assert.equal(e.actualizacion.configurada, false);
  assert.deepEqual(e.registro, []);
});

test("refDeProyecto", () => {
  assert.equal(refDeProyecto("https://hzcs.supabase.co"), "hzcs");
  assert.equal(refDeProyecto("no es url"), "");
});
