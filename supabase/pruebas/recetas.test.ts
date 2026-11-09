// R5: recetas de AHledger (/v1/crafting) y coste de fabricación con los precios del último escaneo.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  actualizarRecetas, leerRecetasAhledger, urlRecetas, ErrorFormato, PROFESIONES, type Db,
} from "../functions/actualizar-mercado/nucleo.ts";

const AHL = "ahledger:forever:us:pvp-horde";
const SLUG = "forever.pvp.horde.us";
const URL_TABLA = `https://api.ahledger.com/v1/pricetable/${SLUG}`;
const HORA = "2026-11-08T18:44:47Z";

// Forma real de la respuesta (2026-11-08), recortada a 2 recetas de Alquimia.
const receta = (spell: number, nombre: string, resId: number, reactivos: [number, string, number][], extra: any = {}) => ({
  recipe: { spellId: spell, name: nombre, profession: "Alchemy", skillRequired: 205, acquisition: "trainer" },
  result: { id: resId, name: nombre, quality: "COMMON", qtyMin: 1, qtyMax: 1, ...extra.result },
  resultPrice: 25000, netValue: 23750, cost: 7755,
  reagents: reactivos.map(([id, name, qty]) => ({ id, name, qty, price: null })),
  unpriced: [],
  ...extra.raiz,
});
const ALQUIMIA = {
  market: SLUG, marketLabel: "PvP Horde US", pricesAsOf: HORA,
  filters: { profession: "Alchemy", all: true, limit: 2000 },
  recipes: [
    receta(15833, "Dreamless Sleep Potion", 12190, [[8831, "Purple Lotus", 3], [8925, "Crystal Vial", 1]]),
    receta(1251750, "Disorienting Smog Potion", 250952, [[8845, "Ghost Mushroom", 3], [3369, "Grave Moss", 2], [8925, "Crystal Vial", 1]]),
  ],
};

describe("lectura de la respuesta de AHledger", () => {
  test("URL de recetas a partir de la tabla de precios", () => {
    assert.equal(urlRecetas(URL_TABLA, "First Aid"),
      `https://api.ahledger.com/v1/crafting/${SLUG}?profession=First%20Aid&all=true&limit=2000`);
    assert.throws(() => urlRecetas("https://otra.cosa/x", "Alchemy"), ErrorFormato);
  });

  test("convierte recetas, reactivos y cantidades", () => {
    const { recetas, descartadas } = leerRecetasAhledger(ALQUIMIA, "Alchemy", SLUG);
    assert.equal(descartadas, 0);
    assert.deepEqual(recetas[0], {
      spell_id: 15833, nombre: "Dreamless Sleep Potion", nivel_requerido: 205, obtencion: "trainer",
      resultado_id: 12190, resultado_nombre: "Dreamless Sleep Potion", resultado_calidad: "COMMON",
      cantidad_min: 1, cantidad_max: 1,
      reactivos: [{ item_id: 8831, nombre: "Purple Lotus", cantidad: 3 }, { item_id: 8925, nombre: "Crystal Vial", cantidad: 1 }],
    });
  });

  test("descarta recetas incompletas en la fuente (sin inventar datos)", () => {
    const j = structuredClone(ALQUIMIA);
    j.recipes.push(receta(1, "Sin reactivos", 5, []));
    j.recipes.push(receta(2, "Cantidad rara", 6, [[1, "x", 0]]));
    j.recipes.push(receta(3, "Sin rendimiento", 7, [[1, "x", 1]], { result: { qtyMin: null } }));
    const { recetas, descartadas } = leerRecetasAhledger(j, "Alchemy", SLUG);
    assert.equal(recetas.length, 2);
    assert.equal(descartadas, 3);
  });

  for (const [nombre, cambio, patron] of [
    ["otro mercado", { market: "forever.pvp.alliance.us" }, /otro mercado/],
    ["otra profesión", { filters: { profession: "Mining", limit: 2000 } }, /otra profesión/],
    ["lista posiblemente cortada", { filters: { profession: "Alchemy", limit: 2 } }, /incompleta/],
    ["sin lista", { recipes: null }, /sin lista/],
  ] as const) {
    test(`rechaza: ${nombre}`, () => assert.throws(() => leerRecetasAhledger({ ...ALQUIMIA, ...cambio }, "Alchemy", SLUG), patron));
  }
});

describe("recetas en la base de datos", () => {
  let pg: PGlite;
  let db: Db;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const guardar = (lista: unknown, prof = "Alchemy") =>
    uno("select guardar_recetas('forever', $1, $2::jsonb, null, $3::timestamptz) as r", [prof, JSON.stringify(lista), HORA]);

  /** Último escaneo con precios (mínimo, mediana) por objeto. */
  async function precios(filas: [number, string, number | null, number | null, number?, number?][], hora = HORA) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count)
                    select id, $2::timestamptz, 1 from markets where key = $1`, [AHL, hora]);
    for (const [id, nombre, min, med, cant, ventas] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, $3 from markets where key = $1
                      on conflict do nothing`, [AHL, id, nombre]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, median, market_value, quantity, sales_per_day, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $5::bigint, $5::bigint,
                             $6::integer, $7::numeric, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [AHL, id, hora, min, med, cant ?? null, ventas ?? null]);
    }
  }

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0014_tasas.sql", "0015_recetas.sql"]) {
      await pg.exec(leer(n));
    }
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
  });

  const lista = () => leerRecetasAhledger(ALQUIMIA, "Alchemy", SLUG).recetas;

  test("coste, valor neto y margen: reproduce el cálculo publicado por AHledger", async () => {
    await guardar(lista());
    await precios([[12190, "Dreamless Sleep Potion", 24000, 25000, 2, 0.1], [8831, "Purple Lotus", 2279, 2480],
                   [8925, "Crystal Vial", 310, 315], [3369, "Grave Moss", 699, 750]]);
    const r = (await uno("select recetas_profesion($1, 'Alchemy') as r", [AHL])).r;
    assert.equal(r.base, "mediana");
    assert.equal(Number(r.comision_pct), 5);
    const d = r.recetas.find((x: any) => x.spell === 15833);
    // AHledger: cost 7755, netValue 23750, margin 15995, marginRatio 2.0625.
    assert.deepEqual([d.coste, d.neto, d.margen, d.margen_pct, d.comision, d.completa], [7755, 23750, 15995, 2.0625, 1250, true]);
    assert.deepEqual(d.reactivos.map((x: any) => [x.nombre, x.cantidad, x.precio, x.coste]),
      [["Purple Lotus", 3, 2480, 7440], ["Crystal Vial", 1, 315, 315]]);
    assert.equal(d.ganancia_dia, 1600);          // 15995 × 0,1 ventas/día (estimación)
    assert.equal(d.dias_para_vender, 20);        // 2 publicadas / 0,1 al día
    // Con el precio mínimo en vez de la mediana:
    const m = (await uno("select recetas_profesion($1, 'Alchemy', 'minimo') as r", [AHL])).r.recetas.find((x: any) => x.spell === 15833);
    assert.deepEqual([m.coste, m.neto], [3 * 2279 + 310, 24000 - 1200]);
  });

  test("si falta el precio de un reactivo, el coste es INCOMPLETO y dice cuál falta", async () => {
    await guardar(lista());
    await precios([[8925, "Crystal Vial", 310, 315], [3369, "Grave Moss", 699, 750]]);
    const d = (await uno("select recetas_profesion($1, 'Alchemy') as r", [AHL])).r.recetas.find((x: any) => x.spell === 1251750);
    assert.equal(d.completa, false);
    assert.equal(d.coste, null);
    assert.equal(d.margen, null);
    assert.deepEqual(d.faltan, ["Ghost Mushroom"]);
    assert.equal(d.coste_parcial, 2 * 750 + 315);
    assert.equal(d.reactivos[0].nombre, "Ghost Mushroom");   // los que faltan, primero
    assert.equal(d.neto, null);                              // tampoco hay precio del resultado
  });

  test("solo cuentan los precios del ÚLTIMO escaneo", async () => {
    await guardar(lista());
    await precios([[8831, "Purple Lotus", 2000, 2000], [8925, "Crystal Vial", 300, 300]], "2026-11-08T10:00:00Z");
    await precios([[8925, "Crystal Vial", 310, 315]]);
    const d = (await uno("select recetas_profesion($1, 'Alchemy') as r", [AHL])).r.recetas.find((x: any) => x.spell === 15833);
    assert.deepEqual(d.faltan, ["Purple Lotus"]);   // no se usa su precio antiguo
  });

  test("rendimiento variable: el valor usa la media de unidades fabricadas", async () => {
    const l = lista();
    l[0].cantidad_min = 1; l[0].cantidad_max = 2;
    await guardar(l);
    await precios([[12190, "Dreamless Sleep Potion", 25000, 25000], [8831, "Purple Lotus", 2480, 2480], [8925, "Crystal Vial", 315, 315]]);
    const d = (await uno("select recetas_profesion($1, 'Alchemy') as r", [AHL])).r.recetas.find((x: any) => x.spell === 15833);
    assert.equal(d.bruto, 37500);
    assert.equal(d.neto, 37500 - 1875);
  });

  test("la comisión es la de la casa de facción (editable en Rentabilidad)", async () => {
    await guardar(lista());
    await precios([[12190, "Dreamless Sleep Potion", 25000, 25000], [8831, "Purple Lotus", 2480, 2480], [8925, "Crystal Vial", 315, 315]]);
    const id = (await uno("select id from auction_fee_rules where tipo_casa = 'faccion' and duracion_horas = 24")).id;
    await uno("select guardar_tasa($1, $2::jsonb)", [id, JSON.stringify({ comision_pct: 6 })]);
    const d = (await uno("select recetas_profesion($1, 'Alchemy') as r", [AHL])).r.recetas.find((x: any) => x.spell === 15833);
    assert.equal(d.comision, 1500);
  });

  test("volver a guardar una profesión sustituye su lista (y no toca las demás)", async () => {
    await guardar(lista());
    const cocina = [{ ...lista()[0], spell_id: 999, nombre: "Pan" }];
    await guardar(cocina, "Cooking");
    await guardar([lista()[0]]);
    assert.equal((await uno("select count(*)::int n from recipes where profesion = 'Alchemy'")).n, 1);
    assert.equal((await uno("select count(*)::int n from recipes where profesion = 'Cooking'")).n, 1);
    assert.equal((await uno("select count(*)::int n from recipe_materials where spell_id = 1251750")).n, 0);
    const p = (await uno("select profesiones_recetas($1) as r", [AHL])).r;
    assert.equal(p.length, PROFESIONES.length);
    assert.equal(p.find((x: any) => x.profesion === "Alchemy").recetas, 1);
    assert.equal(p.find((x: any) => x.profesion === "Tailoring").sincronizado_en, null);
  });

  test("un reactivo repetido se suma", async () => {
    const l = [{ ...lista()[0], reactivos: [{ item_id: 8831, nombre: "Purple Lotus", cantidad: 2 }, { item_id: 8831, nombre: "Purple Lotus", cantidad: 1 }] }];
    await guardar(l);
    assert.equal((await uno("select cantidad from recipe_materials where spell_id = 15833")).cantidad, 3);
  });

  for (const [nombre, l, prof, patron] of [
    ["lista vacía", [], "Alchemy", /vacía/],
    ["profesión desconocida", [{}], "Fishing", /desconocida/],
    ["receta sin reactivos", [{ spell_id: 1, nombre: "x", resultado_id: 1, resultado_nombre: "x", cantidad_min: 1, cantidad_max: 1, reactivos: [] }], "Alchemy", /sin reactivos/],
  ] as const) {
    test(`rechaza: ${nombre}`, async () => assert.rejects(guardar(l, prof), patron));
  }

  test("ficha: recetas que fabrican el objeto y recetas que lo usan", async () => {
    await guardar(lista());
    await precios([[8925, "Crystal Vial", 310, 315]]);
    const v = (await uno("select recetas_objeto($1, 8925) as r", [AHL])).r;
    assert.deepEqual(v.fabricacion, []);
    assert.deepEqual(v.usos.map((u: any) => [u.nombre, u.cantidad]), [["Disorienting Smog Potion", 1], ["Dreamless Sleep Potion", 1]]);
    const p = (await uno("select recetas_objeto($1, 12190) as r", [AHL])).r;
    assert.deepEqual(p.fabricacion.map((x: any) => x.spell), [15833]);
    assert.equal(p.atribucion.texto, "Prices from AHledger");
  });

  test("base de precio no válida", async () => {
    await assert.rejects(uno("select recetas_profesion($1, 'Alchemy', 'media') as r", [AHL]), /no válida/);
  });

  describe("descarga diaria (Edge Function)", () => {
    const AHORA = new Date("2026-11-08T19:00:00Z");
    function falsoFetch(respuestas: Record<string, { status: number; body?: unknown }>, pedidas: string[]) {
      return (async (url: string) => {
        pedidas.push(String(url));
        const prof = decodeURIComponent(new URL(String(url)).searchParams.get("profession")!);
        const r = respuestas[prof] ?? { status: 200, body: { ...ALQUIMIA, filters: { profession: prof, limit: 2000 },
          recipes: ALQUIMIA.recipes.map((x) => ({ ...x, recipe: { ...x.recipe, profession: prof, spellId: x.recipe.spellId + (PROFESIONES as readonly string[]).indexOf(prof) * 10_000_000 } })) } };
        return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
      }) as typeof fetch;
    }

    test("descarga las 11 profesiones una vez y al día siguiente vuelve a tocar", async () => {
      const pedidas: string[] = [];
      const res = await actualizarRecetas(db, { fetch: falsoFetch({}, pedidas), ahora: () => AHORA });
      assert.equal(pedidas.length, 11);
      assert.ok(pedidas.every((u) => u.startsWith(`https://api.ahledger.com/v1/crafting/${SLUG}?profession=`)));
      assert.equal(Object.keys((res as any).guardadas).length, 11);
      assert.equal((await uno("select count(*)::int n from recipes")).n, 22);
      // Una hora después: nada que hacer.
      const otra = await actualizarRecetas(db, { fetch: falsoFetch({}, pedidas), ahora: () => new Date(AHORA.getTime() + 3600e3) });
      assert.equal((otra as any).motivo, "al_dia");
      assert.equal(pedidas.length, 11);
      // 24 h después: vuelve a descargar.
      await actualizarRecetas(db, { fetch: falsoFetch({}, pedidas), ahora: () => new Date(AHORA.getTime() + 24 * 3600e3) });
      assert.equal(pedidas.length, 22);
    });

    test("un 429 para la descarga; un error de formato no borra lo guardado", async () => {
      await guardar(lista());   // Alquimia, descargada hace 15 min: no toca
      await guardar([{ ...lista()[0], spell_id: 77 }], "Blacksmithing");
      await pg.query("update recipe_sync set sincronizado_en = '2026-11-07T00:00:00Z' where profesion = 'Blacksmithing'");
      const pedidas: string[] = [];
      const res: any = await actualizarRecetas(db, {
        fetch: falsoFetch({ Blacksmithing: { status: 200, body: { ...ALQUIMIA, market: "otro" } }, Cooking: { status: 429 } }, pedidas),
        ahora: () => AHORA });
      assert.match(res.errores.Blacksmithing, /otro mercado/);
      assert.equal(res.parado, "HTTP 429");
      assert.equal(pedidas.length, 2);
      assert.ok(!pedidas.some((u) => u.includes("Alchemy")));
      assert.equal((await uno("select count(*)::int n from recipes where profesion = 'Blacksmithing'")).n, 1);
      // El turno queda libre para el siguiente intento.
      assert.equal((await uno("select value from settings where key = 'recetas_turno_hasta'")).value, "-infinity");
    });

    test("no se solapan dos descargas", async () => {
      await uno("select tomar_turno_recetas(300, $1::timestamptz)", [AHORA.toISOString()]);
      const res: any = await actualizarRecetas(db, { fetch: falsoFetch({}, []), ahora: () => AHORA });
      assert.equal(res.motivo, "en_curso");
    });
  });
});
