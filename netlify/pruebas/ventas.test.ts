// Ventas reales y evaluación de recomendaciones (0008) contra PGlite.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { crearApi, type Db } from "../lib/api.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const CSV = "csv:forever:us:pvp-horde", DEMO = "demo:forever:us:demo", TSM = "tsm:forever:us:pvp-horde";
const AHORA = "2026-11-20T12:00:00Z";

let pg: PGlite;
let db: Db;
const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
const importar = (hora: string, filas: object[]) =>
  uno("select importar_precios($1, $2::timestamptz, $3::text::jsonb, 'p.csv', $4::timestamptz) as r",
    [CSV, hora, JSON.stringify(filas), AHORA]);
const venta = (args: Record<string, unknown>) => uno(
  `select registrar_venta($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, null, $10::timestamptz) as r`,
  [args.mercado ?? CSV, args.item ?? 1, args.cantidad ?? 1, args.precio ?? 1000, args.fecha ?? "2026-11-10T12:00:00Z",
    args.comision ?? null, args.deposito ?? null, args.lote ?? null, args.descontar ?? false, AHORA]).then((x) => x.r);
const listado = async (mk = CSV) => (await uno("select ventas_listado($1, $2::timestamptz) as r", [mk, AHORA])).r;
const evaluar = async (mk = CSV) => (await uno("select evaluar_recomendaciones($1, $2::timestamptz) as r", [mk, AHORA])).r;
const log = (item: number, dia: string, rec: string, precio: number) => uno(
  `insert into recommendation_log (market_id, item_id, day, recommendation, confidence, price, explanation)
   select id, $2, $3::date, $4, 50, $5, 'x' from markets where key = $1`, [CSV, item, dia, rec, precio]);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated;");
  await pg.exec(leer("0001_esquema.sql"));
  await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
  for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql", "0008_ventas.sql"]) {
    await pg.exec(leer(n));
  }
  db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
  // Precios: día 10 a 1000, día 17 a 800 (cayó), día 18 a 1300.
  await importar("2026-11-10T10:00:00Z", [{ item_id: 1, name: "Mena", min_buyout: 1000 }, { item_id: 2, name: "Tela", min_buyout: 500 }]);
  await importar("2026-11-17T10:00:00Z", [{ item_id: 1, name: "Mena", min_buyout: 800 }, { item_id: 2, name: "Tela", min_buyout: 700 }]);
  await importar("2026-11-18T10:00:00Z", [{ item_id: 1, name: "Mena", min_buyout: 1300 }, { item_id: 2, name: "Tela", min_buyout: 450 }]);
});

describe("registrar ventas", () => {
  test("con lote: copia el coste, descuenta unidades y calcula el beneficio realizado", async () => {
    const lote = (await uno("select agregar_inventario($1, 1, 30, 600) as r", [CSV])).r.id;
    const r = await venta({ item: 1, cantidad: 10, precio: 1100, lote, descontar: true, deposito: 50 });
    assert.equal(r.descontado, true);
    assert.equal((await uno("select quantity from inventory where id = $1", [lote])).quantity, 20);
    const s = (await listado()).ventas[0];
    assert.equal(s.bruto, 11000);
    assert.equal(s.comision, 550);           // 5 % estimado
    assert.equal(s.comision_estimada, true);
    assert.equal(s.neto, 11000 - 550 - 50);
    assert.equal(s.coste_unitario, 600);
    assert.equal(s.beneficio, 10400 - 6000);
    assert.equal(s.margen, 0.7333);
  });

  test("vender todo el lote lo elimina del inventario", async () => {
    const lote = (await uno("select agregar_inventario($1, 1, 5, 600) as r", [CSV])).r.id;
    await venta({ cantidad: 5, lote, descontar: true });
    assert.equal(Number((await uno("select count(*) n from inventory")).n), 0);
  });

  test("SIN coste (sin lote o lote sin coste): beneficio null y fuera del total", async () => {
    const lote = (await uno("select agregar_inventario($1, 2, 5, null) as r", [CSV])).r.id;
    await venta({ item: 2, cantidad: 1, precio: 600, lote });
    await venta({ item: 1, cantidad: 2, precio: 900, comision: 0 });
    const l = await listado();
    assert.ok(l.ventas.every((s: any) => s.beneficio === null && s.margen === null));
    assert.equal(l.totales.beneficio_con_coste, null);
    assert.equal(l.totales.sin_coste, 2);
    assert.equal(l.totales.comisiones_estimadas, 1);   // la otra registró comisión 0 pagada
  });

  test("comparación con el mercado de ese momento y 7 días después", async () => {
    await venta({ item: 1, precio: 1100, fecha: "2026-11-10T12:00:00Z" });
    const s = (await listado()).ventas[0];
    assert.equal(s.precio_mercado, 1000);        // observado a las 10:00 de ese día
    assert.equal(s.vs_mercado, 0.1);             // vendiste un 10 % por encima
    assert.equal(s.precio_7d, 800);              // el 17 a las 10:00
    assert.equal(s.vs_7d, Number((800 / 1100 - 1).toFixed(4)));
  });

  test("validaciones", async () => {
    await assert.rejects(venta({ item: 99 }), /no existe en este mercado/);
    await assert.rejects(venta({ cantidad: 0 }), /cantidad/);
    await assert.rejects(venta({ precio: -1 }), /precio/);
    await assert.rejects(venta({ fecha: "2026-11-21T12:00:00Z" }), /futuro/);
    await assert.rejects(venta({ fecha: "2025-01-01T00:00:00Z" }), /más de un año/);
    await assert.rejects(venta({ descontar: true }), /elegir un lote/);
    const lote = (await uno("select agregar_inventario($1, 2, 3, 100) as r", [CSV])).r.id;
    await assert.rejects(venta({ item: 1, lote }), /otro objeto/);
    await assert.rejects(venta({ item: 2, cantidad: 4, lote, descontar: true }), /solo tiene 3/);
  });

  test("ventas y lotes no se cruzan entre mercados", async () => {
    await uno("select generar_demo(1, now())");
    const lote = (await uno("select agregar_inventario($1, 1, 3, 100) as r", [CSV])).r.id;
    await assert.rejects(venta({ mercado: DEMO, item: 900001, lote }), /no existe en este mercado/);
    const { id } = await venta({ item: 1 });
    await assert.rejects(uno("select borrar_venta($1, $2)", [DEMO, id]), /no existe en este mercado/);
    assert.equal((await listado(DEMO)).ventas.length, 0);
    assert.equal((await listado(TSM)).ventas.length, 0);
    await uno("select borrar_venta($1, $2)", [CSV, id]);
    assert.equal((await listado()).ventas.length, 0);
  });
});

describe("¿acertó?", () => {
  test("VENDER acierta si después bajó; GUARDAR si después subió", async () => {
    await log(1, "2026-11-10", "VENDER", 1000);   // a los 7 días (17) estaba a 800 → acierto
    await log(2, "2026-11-10", "GUARDAR", 500);   // a los 7 días (17) estaba a 700 → acierto
    await log(2, "2026-11-11", "GUARDAR", 500);   // a los 7 días (18) estaba a 450 → fallo
    const e = await evaluar();
    const v7 = e.resumen.find((x: any) => x.horizonte === 7 && x.rec === "VENDER");
    const g7 = e.resumen.find((x: any) => x.horizonte === 7 && x.rec === "GUARDAR");
    assert.deepEqual([v7.n, v7.aciertos, v7.tasa], [1, 1, 1]);
    assert.equal(v7.cambio_medio, -0.2);
    assert.deepEqual([g7.n, g7.aciertos, g7.tasa], [2, 1, 0.5]);
    assert.equal(e.dias_registrados, 2);
    assert.ok(e.ultimos.some((c: any) => c.acierto === false && c.rec === "GUARDAR"));
  });

  test("recomendaciones recientes quedan pendientes y sin precio quedan «sin dato»", async () => {
    await log(1, "2026-11-18", "VENDER", 1300);   // aún no han pasado 7 días
    await log(1, "2026-11-01", "VENDER", 900);    // a los 7 días (8) no hay precio observado
    const e = await evaluar();
    const v7 = e.resumen.find((x: any) => x.horizonte === 7 && x.rec === "VENDER");
    assert.equal(v7.n, 0);
    assert.equal(v7.tasa, null);
    assert.equal(v7.pendientes, 1);
    assert.equal(v7.sin_dato, 1);
  });

  test("OBSERVACIÓN no se evalúa", async () => {
    await log(1, "2026-11-10", "OBSERVACION", 1000);
    const e = await evaluar();
    assert.ok(e.resumen.every((x: any) => x.n === 0 && x.pendientes === 0));
  });

  test("regenerar el demo borra sus ventas y su registro, no los de otros mercados", async () => {
    await uno("select generar_demo(2, now())");
    await uno("select recalcular_recomendaciones($1)", [DEMO]);
    await uno(`select registrar_venta($1, 900001, 1, 100, now() - interval '1 hour')`, [DEMO]);
    await venta({ item: 1 });
    await log(1, "2026-11-10", "VENDER", 1000);
    await uno("select generar_demo(2, now())");
    const porMercado = async (t: string) => Object.fromEntries((await pg.query<any>(
      `select m.key, count(x.*)::int n from markets m left join ${t} x on x.market_id = m.id group by m.key`)).rows.map((r) => [r.key, r.n]));
    assert.equal((await porMercado("sales"))[DEMO], 0);
    assert.equal((await porMercado("sales"))[CSV], 1);
    assert.equal((await porMercado("recommendation_log"))[DEMO], 0);
    assert.equal((await porMercado("recommendation_log"))[CSV], 1);
  });
});

describe("API de ventas", () => {
  test("requiere sesión, valida y devuelve listado + evaluación", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: TSM, proyecto: "p", ahora: () => new Date(AHORA) });
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (c: unknown, conCookie = true) => new Request("https://x/api/ventas",
      { method: "POST", body: JSON.stringify(c), headers: conCookie ? { cookie } : {} });
    const base = { mercado: CSV, accion: "registrar", item_id: 1, cantidad: 2, precio: 950, vendido_en: "2026-11-10T12:00:00Z" };

    assert.equal((await api.ventas(post(base, false))).status, 401);
    assert.equal((await api.ventas(post({ ...base, precio: "950" }))).status, 400);
    assert.equal((await api.ventas(post({ ...base, comision: 1.5 }))).status, 400);
    assert.equal((await api.ventas(post({ ...base, vendido_en: "2030-01-01T00:00:00Z" }))).status, 422);
    assert.equal((await api.ventas(post(base))).status, 200);
    const g = await (await api.ventas(new Request(`https://x/api/ventas?mercado=${CSV}`, { headers: { cookie } }))).json();
    assert.equal(g.ventas.length, 1);
    assert.equal(g.totales.unidades, 2);
    assert.ok(Array.isArray(g.evaluacion.resumen));
    assert.equal((await api.ventas(post({ mercado: CSV, accion: "borrar", id: g.ventas[0].id }))).status, 200);
  });
});
