// Pruebas de la API de Netlify contra el SQL real (migraciones 0001 + 0003) en PGlite.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { crearApi, crearToken, tokenValido, type Db } from "../lib/api.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const MK = "tsm:forever:us:pvp-horde";
const CLAVE = "una-clave-larga-de-prueba";
const BASE = "https://mercado.example";

let pg: PGlite;
let db: Db;
let reloj: Date;
const ahora = () => new Date(reloj);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated;"); // roles que Supabase ya trae
  await pg.exec(leer("0001_esquema.sql"));
  // En Supabase esta función (0002) llama a pg_net; aquí solo se anota la llamada.
  await pg.exec(`create table disparos (at timestamptz default now());
                 create function disparar_si_corresponde() returns void language sql as
                 $$ insert into disparos default values $$;`);
  await pg.exec(leer("0003_web.sql"));
  await pg.exec(leer("0004_demo_csv.sql"));
  db = { consulta: async (q, p) => (await pg.query<Record<string, unknown>>(q, p)).rows };
  reloj = new Date("2026-11-08T03:00:00Z");
});

const apiCon = (clave: string | undefined) =>
  crearApi(db, { clave, mercado: MK, proyecto: "abcd", ahora, segura: true });
const api = () => apiCon(CLAVE);

const pedir = (ruta: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(BASE + ruta, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) },
  });

const login = (clave: string) => pedir("/api/login", { method: "POST", body: JSON.stringify({ clave }) });

async function entrar(): Promise<string> {
  const r = await api().login(login(CLAVE), "1.1.1.1");
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie")!.split(";")[0];
}

describe("sesión", () => {
  test("token firmado: válido, caducado y manipulado", () => {
    const t = crearToken(CLAVE, reloj);
    assert.ok(tokenValido(CLAVE, t, reloj));
    assert.ok(!tokenValido("otra-clave-distinta-xx", t, reloj));         // cambiar la clave cierra sesiones
    assert.ok(!tokenValido(CLAVE, t, new Date(reloj.getTime() + 31 * 86400e3)));
    const [v, exp, firma] = t.split(".");
    assert.ok(!tokenValido(CLAVE, `${v}.${Number(exp) + 999999}.${firma}`, reloj));
    assert.ok(!tokenValido(CLAVE, "basura", reloj));
    assert.ok(!tokenValido(CLAVE, null, reloj));
  });

  test("login correcto devuelve cookie HttpOnly, Secure y SameSite=Strict", async () => {
    const r = await api().login(login(CLAVE), "1.1.1.1");
    assert.equal(r.status, 200);
    const c = r.headers.get("set-cookie")!;
    assert.match(c, /^mw_sesion=v1\.\d+\./);
    for (const parte of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(c.includes(parte), parte);
    assert.ok(!c.includes(CLAVE));
  });

  test("contraseña incorrecta o vacía: 401", async () => {
    assert.equal((await api().login(login("mala"), "1.1.1.1")).status, 401);
    assert.equal((await api().login(login(""), "1.1.1.1")).status, 401);
    assert.equal((await api().login(pedir("/api/login", { method: "POST", body: "{no json" }), "1.1.1.1")).status, 400);
  });

  test("10 fallos desde una IP en 15 min la bloquean, incluso con la clave buena", async () => {
    for (let i = 0; i < 10; i++) await api().login(login("mala"), "6.6.6.6");
    assert.equal((await api().login(login(CLAVE), "6.6.6.6")).status, 429);
    assert.equal((await api().login(login(CLAVE), "1.1.1.1")).status, 200);  // otra IP sigue pudiendo
    reloj = new Date(reloj.getTime() + 16 * 60e3);
    assert.equal((await api().login(login(CLAVE), "6.6.6.6")).status, 200);
  });

  test("50 fallos repartidos entre IPs bloquean a todos", async () => {
    for (let i = 0; i < 50; i++) await api().login(login("mala"), `10.0.0.${i}`);
    assert.equal((await api().login(login(CLAVE), "1.1.1.1")).status, 429);
  });

  test("sin CLAVE_ACCESO (o demasiado corta) todo queda cerrado", async () => {
    for (const clave of [undefined, "", "corta"]) {
      const a = apiCon(clave);
      assert.equal((await a.login(login("x"), "1.1.1.1")).status, 500);
      assert.equal((await a.estado(pedir("/api/estado"))).status, 500);
      assert.equal((await a.actualizar(pedir("/api/actualizar", { method: "POST" }))).status, 500);
    }
  });

  test("logout borra la cookie", async () => {
    const c = (await api().logout(pedir("/api/logout", { method: "POST" }))).headers.get("set-cookie")!;
    assert.match(c, /^mw_sesion=;/);
    assert.match(c, /Max-Age=0/);
  });
});

describe("estado", () => {
  test("sin sesión: 401 y ningún dato", async () => {
    const r = await api().estado(pedir("/api/estado"));
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "no_autenticado" });
  });

  test("con sesión: estado del mercado PvP Horda, sin credenciales", async () => {
    const r = await api().estado(pedir("/api/estado", { cookie: await entrar() }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const s = await r.json();
    assert.equal(s.mercado.clave, MK);
    assert.equal(s.mercado.ficticio, false);
    assert.equal(s.actualizacion.configurada, false);
    assert.equal(s.actualizacion.proxima, null);   // '-infinity' → null
    assert.deepEqual(s.registro, []);
    assert.equal(s.autenticado, true);
    assert.ok(!JSON.stringify(s).includes(CLAVE));
  });

  test("falta la migración 0003: mensaje claro", async () => {
    await pg.exec("drop function estado_mercado(text)");
    const r = await api().estado(pedir("/api/estado", { cookie: await entrar() }));
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /migraciones/);
  });
});

describe("botón actualizar", () => {
  test("sin sesión: 401 y no dispara nada", async () => {
    const r = await api().actualizar(pedir("/api/actualizar", { method: "POST" }));
    assert.equal(r.status, 401);
    assert.equal((await pg.query("select count(*)::int n from disparos")).rows[0].n, 0);
  });

  test("solo POST", async () => {
    assert.equal((await api().actualizar(pedir("/api/actualizar", { cookie: await entrar() }))).status, 405);
  });

  test("dispara una vez y protege contra pulsaciones repetidas", async () => {
    const cookie = await entrar();
    const r1 = await api().actualizar(pedir("/api/actualizar", { method: "POST", cookie }));
    assert.equal(r1.status, 202);
    const r2 = await api().actualizar(pedir("/api/actualizar", { method: "POST", cookie }));
    assert.equal(r2.status, 429);
    assert.match((await r2.json()).mensaje, /Espera \d+ s/);
    assert.equal((await pg.query("select count(*)::int n from disparos")).rows[0].n, 1);
  });
});
