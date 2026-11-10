// X1 (plan V5): «Qué hacer con este objeto». Lógica de Auctioning de TSM adaptada a precios agregados.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PERFIL_POR_DEFECTO, banda, sugerencia, textoMotivo } from "../../app/static/subasta.js";
import { formatearMoneda } from "../../app/static/moneda.js";
import { crearApi, type Db } from "../lib/api.ts";

// Regla de la casa de facción a 24 h (valores iniciales de 0014).
const REGLA = { comision_pct: 5, deposito_pct: 60, deposito_minimo: 100, redondeo: "floor", verificado: false };

describe("banda de precios", () => {
  test("preset 80/100/300 % del valor de mercado, con los suelos de venta al NPC", () => {
    assert.deepEqual(banda(10_000, 10), { min: 8_000, normal: 10_000, max: 30_000 });
    // Un objeto barato con NPC alto: el mínimo sube a 1,5× el NPC y el máximo a 30×.
    assert.deepEqual(banda(100, 200), { min: 300, normal: 300, max: 6_000 });
  });
  test("sin valor de mercado no hay banda; sin NPC, solo el mercado", () => {
    assert.equal(banda(null, 50), null);
    assert.deepEqual(banda(1_000, null), { min: 800, normal: 1_000, max: 3_000 });
  });
});

describe("sugerencia (lógica de publicación)", () => {
  const s = (compraMinima: number | null, mercado: number | null, ventaNpc: number | null = null, perfil = PERFIL_POR_DEFECTO) =>
    sugerencia({ compraMinima, mercado, ventaNpc }, perfil, REGLA);

  test("sin ofertas → precio normal", () => {
    const r = s(null, 10_000);
    assert.deepEqual([r.accion, r.precio, r.motivo], ["publicar", 10_000, "normal"]);
  });
  test("dentro de la banda → 1c por debajo de la compra mínima, con puja, neto y depósito", () => {
    const r = s(9_500, 10_000, 20);
    assert.deepEqual([r.accion, r.precio, r.motivo, r.puja], ["publicar", 9_499, "undercut", 9_499]);
    assert.equal(r.comision, 474);                 // 5 % de 9.499 hacia abajo
    assert.equal(r.neto, 9_499 - 474);
    assert.equal(r.deposito, 100);                 // 60 % de 20c = 12c < mínimo de 1p
  });
  test("compra mínima por debajo del mínimo → esperar (como TSM por defecto)", () => {
    const r = s(7_000, 10_000);
    assert.deepEqual([r.accion, r.precio, r.motivo], ["esperar", null, "bajo_minimo"]);
  });
  test("compra mínima por encima del máximo → el máximo", () => {
    const r = s(50_000, 10_000);
    assert.deepEqual([r.accion, r.precio, r.motivo], ["publicar", 30_000, "sobre_maximo"]);
  });
  test("si el neto de la subasta no supera al NPC → vender al NPC (y se dice por qué)", () => {
    const r = s(105, 100, 102);   // banda: mín max(80, 153)=153 → 104 < 153 → esperar; mín 153 > NPC 102 → sigue esperando
    assert.equal(r.accion, "esperar");
    const r2 = s(null, 100, 99);  // sin ofertas: normal = max(100, 149) = 149 → neto 149 − 7 = 142 > 99 → publicar
    assert.equal(r2.accion, "publicar");
    const barato = sugerencia({ compraMinima: 50, mercado: 60, ventaNpc: 60 },
      { ...PERFIL_POR_DEFECTO, npc_min_mult: 0.5 }, REGLA);   // mín = max(48, 30) = 48; 49 → neto 47 < 60 → NPC
    assert.deepEqual([barato.accion, barato.accionSubasta, barato.precio, barato.neto], ["npc", "publicar", 49, 47]);
  });
  test("esperar con un mínimo que no supera al NPC → vender al NPC", () => {
    const r = sugerencia({ compraMinima: 10, mercado: 100, ventaNpc: 90 }, { ...PERFIL_POR_DEFECTO, npc_min_mult: 0 }, REGLA);
    assert.deepEqual([r.accion, r.accionSubasta, r.banda.min], ["npc", "esperar", 80]);
  });
  test("puja: % del precio, nunca bajo el mínimo ni sobre el precio", () => {
    const r = s(9_500, 10_000, null, { ...PERFIL_POR_DEFECTO, puja_pct: 50 });
    assert.equal(r.puja, 8_000);                  // 50 % = 4.749,5 → sube al mínimo (8.000)
  });
  test("rebaja configurable (0 = igualar la compra mínima)", () => {
    assert.equal(s(9_500, 10_000, null, { ...PERFIL_POR_DEFECTO, undercut: 0 }).precio, 9_500);
    assert.equal(s(9_500, 10_000, null, { ...PERFIL_POR_DEFECTO, undercut: 100 }).precio, 9_400);
  });
  test("sin valor de mercado: si hay NPC, se ofrece el NPC; si no, nada que sugerir", () => {
    assert.equal(s(500, null, 40).accion, "npc");
    assert.equal(s(500, null, null).accion, "sin_datos");
  });
  test("cada motivo tiene su texto con cifras", () => {
    const t = (r: any) => textoMotivo(r, formatearMoneda);
    assert.match(t(s(9_500, 10_000)), /1c por debajo de la compra mínima actual \(95p\)/);
    assert.match(t(s(7_000, 10_000)), /por debajo de tu mínimo \(80p\)/);
    assert.match(t(s(50_000, 10_000)), /supera tu máximo/);
    assert.match(t(s(null, 10_000)), /precio normal de tu banda \(1o\)/);
    assert.match(t(s(500, null, 40)), /El NPC paga 40c/);
  });
});

describe("banda guardada en la base de datos", () => {
  let pg: PGlite;
  let db: Db;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0024_perfil_subasta.sql"]) await pg.exec(leer(n));
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
  });

  test("valores por defecto = los de la página", async () => {
    const p = (await uno("select leer_perfil_subasta() as r")).r;
    for (const [k, v] of Object.entries(PERFIL_POR_DEFECTO)) assert.equal(k === "tipo_casa" ? p[k] : Number(p[k]), v, k);
  });

  test("guardar y validar", async () => {
    const p = (await uno("select guardar_perfil_subasta($1::jsonb) as r", [JSON.stringify({ min_pct: 90, undercut: 0, tipo_casa: "neutral" })])).r;
    assert.deepEqual([Number(p.min_pct), Number(p.undercut), p.tipo_casa, Number(p.max_pct)], [90, 0, "neutral", 300]);
    for (const [mal, patron] of [
      [{ min_pct: 5 }, /fuera de rango/], [{ normal_pct: 50, min_pct: 80 }, /mínimo ≤ normal ≤ máximo/],
      [{ duracion: 12 }, /2, 8 o 24/], [{ tipo_casa: "goblin" }, /faccion o neutral/], [{ undercut: 1.5 }, /entero/],
      [{ otra: 1 }, /desconocido/], [{ puja_pct: "mucho" }, /no es un número/],
    ] as const) {
      await assert.rejects(uno("select guardar_perfil_subasta($1::jsonb)", [JSON.stringify(mal)]), patron);
    }
  });

  test("API /api/perfil-subasta: sesión y validación", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: "tsm:forever:us:pvp-horde", proyecto: "p" });
    assert.equal((await api.perfilSubasta(new Request("https://x/api/perfil-subasta"))).status, 401);
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (c: unknown) => api.perfilSubasta(new Request("https://x/api/perfil-subasta", { method: "POST", body: JSON.stringify(c), headers: { cookie } }));
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ ajustes: { min_pct: 1 } })).status, 422);
    assert.equal(Number((await (await post({ ajustes: { max_pct: 400 } })).json()).max_pct), 400);
  });
});
