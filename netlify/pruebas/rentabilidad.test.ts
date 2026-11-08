// R4: calculadora en cobre entero y reglas de comisión/depósito (0014).

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { calcular, repartir, subastas } from "../../app/static/rentabilidad.js";
import { crearApi, type Db } from "../lib/api.ts";

// Regla inicial de la casa de facción a 24 h (valores por verificar de la especificación).
const FACCION_24 = { comision_pct: 5, deposito_pct: 60, deposito_minimo: 100, redondeo: "floor", verificado: false };
const NEUTRAL_2 = { comision_pct: 15, deposito_pct: 5, deposito_minimo: 100, redondeo: "floor", verificado: false };
const base = { modoPrecio: "unitario", cantidad: 1, porSubasta: 20, coste: null, modoCoste: "unitario", ventaNpc: null, fallidas: 0 };

describe("utilidades", () => {
  test("subastas: 45 unidades de 20 en 20", () => assert.deepEqual(subastas(45, 20), [20, 20, 5]));
  test("repartir un total sin perder cobres", () => {
    assert.deepEqual(repartir(100, [20, 20, 5]), [45, 44, 11]);
    assert.equal(repartir(100, [20, 20, 5]).reduce((a, b) => a + b), 100);
    assert.deepEqual(repartir(10, [1, 1, 1]), [4, 3, 3]);
  });
});

describe("calculadora", () => {
  test("ejemplo: 20 Essence of Air a 1o 20p, coste 80p, venta al NPC 4p, facción 24 h", () => {
    const r = calcular({ ...base, precio: 12000, cantidad: 20, coste: 8000, ventaNpc: 400 }, FACCION_24);
    assert.equal(r.valorTotal, 240000);           // 24o
    assert.equal(r.comision, 12000);              // 5 % = 1o 20p
    assert.equal(r.depositoInicial, 4800);        // 60 % de 4p × 20 = 48p
    assert.equal(r.reembolsoDeposito, 4800);
    assert.equal(r.ingresoNeto, 228000);          // precio − comisión (el depósito vuelve)
    assert.equal(r.recibidoPorCorreo, 232800);    // venta − comisión + depósito devuelto
    assert.equal(r.costeTotal, 160000);
    assert.equal(r.beneficio, 68000);             // 6o 80p
    assert.equal(r.margen, 0.425);
    assert.equal(r.depositosPerdidos, 0);
  });

  test("el depósito de la subasta vendida NO se descuenta", () => {
    const r = calcular({ ...base, precio: 10000, coste: 5000, ventaNpc: 10000 }, FACCION_24);
    assert.equal(r.depositoInicial, 6000);
    assert.equal(r.beneficio, 10000 - 500 - 5000);
  });

  test("publicaciones fallidas: se pierden sus depósitos (estimados o reales)", () => {
    const est = calcular({ ...base, precio: 10000, coste: 5000, ventaNpc: 1000, fallidas: 2 }, FACCION_24);
    assert.equal(est.depositoInicial, 600);
    assert.equal(est.depositosPerdidos, 1200);
    assert.equal(est.depositosPerdidosEstimados, true);
    assert.equal(est.beneficio, 9500 - 5000 - 1200);
    const real = calcular({ ...base, precio: 10000, coste: 5000, ventaNpc: 1000, fallidas: 2, depositosPerdidosReales: 900 }, FACCION_24);
    assert.equal(real.depositosPerdidos, 900);
    assert.equal(real.depositosPerdidosEstimados, false);
  });

  test("depósito mínimo por subasta (1 plata) y valor de NPC desconocido", () => {
    const r = calcular({ ...base, precio: 50, cantidad: 45, porSubasta: 20, ventaNpc: null }, FACCION_24);
    assert.equal(r.subastas, 3);
    assert.equal(r.depositoInicial, 300);         // 3 × 1p
    assert.ok(r.supuestos.some((s: string) => /desconocido/.test(s)));
    const barato = calcular({ ...base, precio: 50, ventaNpc: 10 }, FACCION_24);
    assert.equal(barato.depositoInicial, 100);    // 60 % de 10c = 6c < mínimo 1p
  });

  test("comisión con redondeo por subasta (hacia abajo por defecto)", () => {
    // 3 subastas de 1 unidad a 19c: 5 % = 0,95c → 0c cada una.
    const r = calcular({ ...base, precio: 19, cantidad: 3, porSubasta: 1 }, FACCION_24);
    assert.equal(r.comision, 0);
    const redondo = calcular({ ...base, precio: 19, cantidad: 3, porSubasta: 1 }, { ...FACCION_24, redondeo: "round" });
    assert.equal(redondo.comision, 3);
  });

  test("precio total que no divide exacto: se reparte entre subastas sin perder cobre", () => {
    const r = calcular({ ...base, precio: 100001, modoPrecio: "total", cantidad: 45, porSubasta: 20 }, FACCION_24);
    assert.equal(r.valorTotal, 100001);
    assert.equal(r.ingresoNeto, 100001 - r.comision);
  });

  test("casa neutral: 15 %", () => {
    const r = calcular({ ...base, precio: 10000 }, NEUTRAL_2);
    assert.equal(r.comision, 1500);
  });

  test("SIN coste: no hay ganancia ni margen (null), pero sí ingreso neto", () => {
    const r = calcular({ ...base, precio: 10000 }, FACCION_24);
    assert.equal(r.beneficio, null);
    assert.equal(r.margen, null);
    assert.equal(r.ingresoNeto, 9500);
    assert.ok(r.supuestos.some((s: string) => /Sin coste/.test(s)));
  });

  test("precio mínimo para no perder oro: el menor precio unitario con beneficio ≥ 0", () => {
    const e = { ...base, cantidad: 20, coste: 8000, ventaNpc: 400, fallidas: 1 };
    const r = calcular({ ...e, precio: 1 }, FACCION_24);
    const p = r.precioEquilibrioUnitario;
    assert.ok(calcular({ ...e, precio: p }, FACCION_24).beneficio >= 0);
    assert.ok(calcular({ ...e, precio: p - 1 }, FACCION_24).beneficio < 0);
    // Sin coste ni depósitos perdidos, cualquier precio cubre.
    assert.equal(calcular({ ...base, precio: 5 }, FACCION_24).precioEquilibrioUnitario, 0);
  });

  test("pérdida: beneficio negativo y margen negativo", () => {
    const r = calcular({ ...base, precio: 1000, coste: 2000 }, FACCION_24);
    assert.equal(r.beneficio, 950 - 2000);
    assert.ok(r.margen! < 0);
  });

  for (const [nombre, e] of [
    ["cantidad 0", { ...base, precio: 1, cantidad: 0 }],
    ["precio decimal", { ...base, precio: 1.5 }],
    ["por subasta 0", { ...base, precio: 1, porSubasta: 0 }],
    ["fallidas negativas", { ...base, precio: 1, fallidas: -1 }],
  ] as const) {
    test(`rechaza: ${nombre}`, () => assert.ok(calcular(e as any, FACCION_24).errores.length > 0));
  }
});

describe("reglas en la base de datos", () => {
  let pg: PGlite;
  let db: Db;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0014_tasas.sql"]) await pg.exec(leer(n));
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
  });

  test("valores iniciales de la especificación, sin verificar y con vigencia", async () => {
    const t = (await uno("select leer_tasas() as r")).r;
    assert.equal(t.length, 6);
    const f24 = t.find((x: any) => x.tipo_casa === "faccion" && x.duracion_horas === 24);
    assert.deepEqual([Number(f24.comision_pct), Number(f24.deposito_pct), Number(f24.deposito_minimo), f24.verificado, f24.vigente_desde],
      [5, 60, 100, false, "2026-11-08"]);
    assert.deepEqual(t.filter((x: any) => x.tipo_casa === "neutral").map((x: any) => Number(x.comision_pct)), [15, 15, 15]);
  });

  test("cambiar la comisión de facción afecta a todas sus duraciones y al motor", async () => {
    const id = (await uno("select id from auction_fee_rules where tipo_casa = 'faccion' and duracion_horas = 2")).id;
    await uno("select guardar_tasa($1, $2::jsonb, '2026-11-09'::date)", [id, JSON.stringify({ comision_pct: 6, verificado: true })]);
    const t = (await uno("select leer_tasas() as r")).r;
    assert.deepEqual(t.filter((x: any) => x.tipo_casa === "faccion").map((x: any) => Number(x.comision_pct)), [6, 6, 6]);
    assert.equal(t.find((x: any) => x.id === id).verificado, true);
    assert.equal(t.find((x: any) => x.tipo_casa === "faccion" && x.duracion_horas === 24).verificado, false);
    assert.equal(t.find((x: any) => x.id === id).vigente_desde, "2026-11-09");
    assert.equal((await uno("select value from settings where key = 'motor.comision_pct'")).value, "6");
    assert.deepEqual(t.filter((x: any) => x.tipo_casa === "neutral").map((x: any) => Number(x.comision_pct)), [15, 15, 15]);
  });

  test("el % de depósito es por duración", async () => {
    const id = (await uno("select id from auction_fee_rules where tipo_casa = 'faccion' and duracion_horas = 8")).id;
    await uno("select guardar_tasa($1, $2::jsonb)", [id, JSON.stringify({ deposito_pct: 25 })]);
    const t = (await uno("select leer_tasas() as r")).r.filter((x: any) => x.tipo_casa === "faccion");
    assert.deepEqual(t.map((x: any) => Number(x.deposito_pct)), [5, 25, 60]);
  });

  for (const [nombre, cambios, patron] of [
    ["comisión fuera de rango", { comision_pct: 80 }, /fuera de rango/],
    ["campo no editable", { tipo_casa: "neutral" }, /no editable/],
    ["no numérico", { deposito_pct: "mucho" }, /no es un número/],
    ["mínimo con decimales", { deposito_minimo: 1.5 }, /entero/],
  ] as const) {
    test(`rechaza: ${nombre}`, async () => {
      const id = (await uno("select id from auction_fee_rules limit 1")).id;
      await assert.rejects(uno("select guardar_tasa($1, $2::jsonb)", [id, JSON.stringify(cambios)]), patron);
    });
  }

  test("API: requiere sesión y valida", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: "ahledger:forever:us:pvp-horde", proyecto: "p" });
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await api.tasas(new Request("https://x/api/tasas"))).status, 401);
    assert.equal((await (await api.tasas(new Request("https://x/api/tasas", { headers: { cookie } }))).json()).length, 6);
    const post = (c: unknown) => new Request("https://x/api/tasas", { method: "POST", body: JSON.stringify(c), headers: { cookie } });
    assert.equal((await api.tasas(post({ id: "1", cambios: {} }))).status, 400);
    assert.equal((await api.tasas(post({ id: 999, cambios: { comision_pct: 5 } }))).status, 422);
    assert.equal((await api.tasas(post({ id: 1, cambios: { comision_pct: 5 } }))).status, 200);
  });
});
