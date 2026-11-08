// Inventario, beneficio y margen (0007) + lectura de CSV de inventario + utilidades del gráfico.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { leerCsvInventario } from "../../app/static/csv.js";
import { marcasEje, monedaCorta } from "../../app/static/grafico.js";
import { crearApi, type Db } from "../lib/api.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const CSV = "csv:forever:us:pvp-horde", DEMO = "demo:forever:us:demo", TSM = "tsm:forever:us:pvp-horde";

let pg: PGlite;
let db: Db;
const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
const inv = async (mk = CSV) => (await uno("select inventario_valorado($1) as r", [mk])).r;
const importarPrecios = (filas: object[], hora = "2026-11-08T02:00:00Z") =>
  uno("select importar_precios($1, $2::timestamptz, $3::text::jsonb, 'p.csv', '2026-12-31'::timestamptz) as r",
    [CSV, hora, JSON.stringify(filas)]);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated;");
  await pg.exec(leer("0001_esquema.sql"));
  await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
  for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql"]) {
    await pg.exec(leer(n));
  }
  db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
  await importarPrecios([
    { item_id: 1, name: "Mena de cobre", min_buyout: 1000 },
    { item_id: 2, name: "Mena de hierro", min_buyout: 2500 },
    { item_id: 3, name: "Duplicado", min_buyout: 10 },
    { item_id: 4, name: "duplicado", min_buyout: 10 },
  ]);
});

describe("valor del inventario", () => {
  test("cálculo con coste: bruto, comisión, depósito, neto, beneficio y margen", async () => {
    await uno("select agregar_inventario($1, 1, 20, 500)", [CSV]);
    const f = (await inv()).filas[0];
    assert.equal(f.bruto, 20000);           // 1000 × 20
    assert.equal(f.comision, 1000);         // 5 %
    assert.equal(f.publicaciones, 1);       // 20 unidades por publicación
    assert.equal(f.deposito, 100);          // recuperable si se vende
    assert.equal(f.perdida_deposito, 50);   // 50 % supuesto de caducar
    assert.equal(f.neto, 18950);
    assert.equal(f.coste_total, 10000);
    assert.equal(f.beneficio, 8950);
    assert.equal(f.margen, 0.895);
  });

  test("SIN coste: no hay beneficio ni margen (null, nunca 0) y no entra en el total", async () => {
    await uno("select agregar_inventario($1, 1, 20, 500)", [CSV]);
    await uno("select agregar_inventario($1, 2, 10, null)", [CSV]);
    const r = await inv();
    const sinCoste = r.filas.find((f: any) => f.item_id === 2);
    assert.equal(sinCoste.coste_total, null);
    assert.equal(sinCoste.beneficio, null);
    assert.equal(sinCoste.margen, null);
    assert.equal(sinCoste.neto, 25000 - 1250 - 50);     // el neto sí se calcula
    assert.equal(r.totales.beneficio_con_coste, 8950);  // solo el lote con coste
    assert.equal(r.totales.con_coste, 1);
    assert.equal(r.totales.sin_coste, 1);
    assert.equal(r.totales.neto, 18950 + 23700);
  });

  test("coste 0 conocido SÍ calcula beneficio (distinto de desconocido)", async () => {
    await uno("select agregar_inventario($1, 1, 1, 0)", [CSV]);
    const f = (await inv()).filas[0];
    assert.equal(f.coste_total, 0);
    assert.equal(f.beneficio, f.neto);
    assert.equal(f.margen, null);   // margen sobre 0 no tiene sentido
  });

  test("varias publicaciones y supuestos editables", async () => {
    await uno("select guardar_ajustes('{\"motor.unidades_por_publicacion\": 5, \"motor.prob_no_venta_pct\": 0, \"motor.comision_pct\": 15}'::jsonb)");
    await uno("select agregar_inventario($1, 1, 12, null)", [CSV]);
    const r = await inv();
    const f = r.filas[0];
    assert.equal(f.publicaciones, 3);
    assert.equal(f.deposito, 300);
    assert.equal(f.perdida_deposito, 0);
    assert.equal(f.comision, 1800);
    assert.equal(r.supuestos.comision_pct, 15);
  });

  test("la recomendación del objeto acompaña al lote", async () => {
    await uno("select agregar_inventario($1, 1, 1, null)", [CSV]);
    await uno("select recalcular_recomendaciones($1)", [CSV]);
    const f = (await inv()).filas[0];
    assert.equal(f.rec, "OBSERVACION");
    assert.match(f.resumen, /Historial insuficiente \(0,0 días, 1 observación\)/);   // singular corregido
  });
});

describe("altas, cambios y separación de mercados", () => {
  test("validaciones al añadir", async () => {
    await assert.rejects(uno("select agregar_inventario($1, 99, 1)", [CSV]), /no existe en este mercado/);
    await assert.rejects(uno("select agregar_inventario($1, 1, 0)", [CSV]), /cantidad/);
    await assert.rejects(uno("select agregar_inventario($1, 1, 1, -5)", [CSV]), /negativo/);
    await assert.rejects(uno("select agregar_inventario('nada', 1, 1)"), /desconocido/);
  });

  test("editar y borrar solo dentro del mismo mercado", async () => {
    const { id } = (await uno("select agregar_inventario($1, 1, 5, 100) as r", [CSV])).r;
    await uno("select generar_demo(1, now())");
    await assert.rejects(uno("select editar_inventario($1, $2, 9, null)", [DEMO, id]), /no existe en este mercado/);
    await assert.rejects(uno("select borrar_inventario($1, $2)", [DEMO, id]), /no existe en este mercado/);
    await uno("select editar_inventario($1, $2, 9, null)", [CSV, id]);
    const f = (await inv()).filas[0];
    assert.equal(f.cantidad, 9);
    assert.equal(f.coste_unitario, null);   // coste borrado → desconocido
    await uno("select borrar_inventario($1, $2)", [CSV, id]);
    assert.equal((await inv()).filas.length, 0);
  });

  test("el inventario de un mercado no aparece en otro", async () => {
    await uno("select agregar_inventario($1, 1, 5, 100)", [CSV]);
    await uno("select generar_demo(1, now())");
    assert.equal((await inv(DEMO)).filas.length, 0);
    assert.equal((await inv(TSM)).filas.length, 0);
  });

  test("importar: por ID o nombre (sin distinguir mayúsculas), todo o nada", async () => {
    const r = (await uno(`select importar_inventario($1, $2::jsonb) as r`, [CSV, JSON.stringify([
      { item_id: 1, cantidad: 3, coste: 900 },
      { nombre: "MENA DE HIERRO", cantidad: 2 },
    ])])).r;
    assert.equal(r.importados, 2);
    await assert.rejects(uno(`select importar_inventario($1, $2::jsonb)`, [CSV, JSON.stringify([
      { item_id: 1, cantidad: 1 }, { nombre: "duplicado", cantidad: 1 }, { nombre: "no existe", cantidad: 1 },
    ])]), /coincide con 2 objetos.*no hay ningún objeto llamado «no existe»/);
    assert.equal((await inv()).filas.length, 2);   // el fallo no dejó nada a medias
  });

  test("importar con reemplazo", async () => {
    await uno("select agregar_inventario($1, 1, 5, 100)", [CSV]);
    await uno(`select importar_inventario($1, $2::jsonb, true)`, [CSV, JSON.stringify([{ item_id: 2, cantidad: 1 }])]);
    const filas = (await inv()).filas;
    assert.deepEqual(filas.map((f: any) => f.item_id), [2]);
  });
});

describe("historial para el gráfico", () => {
  test("puntos en orden con [hora, compra mínima, valor de mercado] y medianas", async () => {
    await uno("select generar_demo(3, now())");
    await uno("select recalcular_recomendaciones($1)", [DEMO]);
    const h = (await uno("select historial_objeto($1, 900009, 30) as r", [DEMO])).r;
    assert.ok(h.puntos.length > 60);
    assert.ok(h.puntos.every((p: number[], i: number, a: number[][]) => i === 0 || p[0] > a[i - 1][0]));
    assert.equal(h.puntos[0].length, 3);
    assert.ok(h.med30 > 0);
    const corto = (await uno("select historial_objeto($1, 900009, 1) as r", [DEMO])).r;
    assert.ok(corto.puntos.length <= 24);
  });
});

describe("CSV de inventario (navegador)", () => {
  test("por nombre o ID, coste opcional, vacío = desconocido", () => {
    const r = leerCsvInventario("nombre;cantidad;coste\nMena de cobre;20;5p\nMena de hierro;3;\n");
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.filas, [{ nombre: "Mena de cobre", cantidad: 20, coste: 500 }, { nombre: "Mena de hierro", cantidad: 3, coste: null }]);
    const s = leerCsvInventario("itemId,cantidad\n2770,5\n");
    assert.deepEqual(s.filas, [{ item_id: 2770, cantidad: 5, coste: null }]);
  });

  for (const [nombre, texto, patron] of [
    ["sin cantidad", "itemId\n1\n", /cantidad/],
    ["sin objeto", "cantidad\n1\n", /itemId o nombre/],
    ["cantidad 0", "itemId,cantidad\n1,0\n", /cantidad no válida/],
    ["cantidad decimal", "itemId,cantidad\n1,2.5\n", /cantidad no válida/],
    ["coste ambiguo", "itemId,cantidad,coste\n1,2,12.5\n", /Precio no válido/],
  ] as const) {
    test(`rechaza: ${nombre}`, () => {
      const r = leerCsvInventario(texto);
      assert.equal(r.filas.length, 0);
      assert.match(r.errores.join(" | "), patron);
    });
  }
});

describe("gráfico", () => {
  test("marcas del eje redondas y que cubren el rango", () => {
    assert.deepEqual(marcasEje(0, 100), [0, 25, 50, 75, 100]);
    assert.deepEqual(marcasEje(7000, 12000), [8000, 10000, 12000]);
    assert.deepEqual(marcasEje(123, 987), [200, 400, 600, 800]);
    assert.deepEqual(marcasEje(1, 2), [1, 2]);                 // sin marcas repetidas
    assert.equal(new Set(marcasEje(5000, 5000)).size, marcasEje(5000, 5000).length);
    assert.deepEqual(marcasEje(NaN, 5), []);
  });

  test("abreviaturas del eje en oro", () => {
    assert.equal(monedaCorta(950), "9p 50c");
    assert.equal(monedaCorta(123456), "12,3o");
    assert.equal(monedaCorta(2_500_000), "250o");
  });
});

describe("API de inventario e historial", () => {
  test("requiere sesión, valida y aplica acciones", async () => {
    const CLAVE = "una-clave-larga-de-prueba";
    const api = crearApi(db, { clave: CLAVE, mercado: TSM, proyecto: "p" });
    const login = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (c: unknown, conCookie = true) => new Request("https://x/api/inventario",
      { method: "POST", body: JSON.stringify(c), headers: conCookie ? { cookie } : {} });

    assert.equal((await api.inventario(post({ mercado: CSV, accion: "agregar", item_id: 1, cantidad: 1 }, false))).status, 401);
    assert.equal((await api.inventario(post({ mercado: CSV, accion: "agregar", item_id: 1, cantidad: "1" }))).status, 400);
    assert.equal((await api.inventario(post({ mercado: CSV, accion: "volar" }))).status, 400);
    assert.equal((await api.inventario(post({ mercado: CSV, accion: "agregar", item_id: 99, cantidad: 1 }))).status, 422);
    const ok = await api.inventario(post({ mercado: CSV, accion: "agregar", item_id: 1, cantidad: 4, coste: null }));
    assert.equal(ok.status, 200);
    const v = await (await api.inventario(new Request(`https://x/api/inventario?mercado=${CSV}`, { headers: { cookie } }))).json();
    assert.equal(v.filas[0].cantidad, 4);
    assert.equal(v.filas[0].beneficio, null);

    const h = await api.historial(new Request(`https://x/api/historial?mercado=${CSV}&id=1`, { headers: { cookie } }));
    assert.equal(h.status, 200);
    assert.equal((await api.historial(new Request(`https://x/api/historial?id=1&dias=90`, { headers: { cookie } }))).status, 400);
  });
});
