// Informe diario del mercado: SQL (PGlite) + tarea de la Edge Function con un Discord falso.
// Comprueba los cálculos con datos conocidos, que las horas incompletas no cuentan, que no se inventa nada,
// el envío con imagen adjunta, que el automático sale una vez al día a su hora y la validación.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ejecutarInforme } from "../functions/actualizar-mercado/informe.ts";
import { analizarInforme, completarInforme, informeSVG, paginasInforme } from "../../app/static/informe.js";
import type { Db } from "../functions/actualizar-mercado/nucleo.ts";

const AHL = "ahledger:forever:us:pvp-horde";
const URL_WH = "https://discord.com/api/webhooks/123456789012345678/" + "B".repeat(68);
const AHORA = new Date("2026-11-24T12:30:00Z");
const sinEspera = async () => {};
const H = 3600e3;

describe("informe diario (SQL + tarea)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const db: Db = { consulta: async (q, p) => (await pg.query<any>(q, p as unknown[])).rows };

  // Un escaneo: [id, compra mínima, cantidad, ventas/día, mediana 30 días].
  async function escaneo(ms: number, filas: [number, number, number, number | null, number | null][]) {
    const hora = new Date(ms).toISOString();
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1
                    on conflict do nothing`, [AHL, hora]);
    for (const [id, min, q, v, h30] of filas) {
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, quantity, sales_per_day, historical, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $5::integer, $6::numeric, $7::bigint, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [AHL, id, hora, min, q, v, h30]);
    }
  }
  function discord() {
    const recibidos: { url: string; cuerpo: any; archivo?: Blob; archivos?: string[] }[] = [];
    const f = (async (url: string, init: any) => {
      if (init.body instanceof FormData) recibidos.push({ url, cuerpo: JSON.parse(String(init.body.get("payload_json"))), archivo: init.body.get("files[0]") as Blob,
        archivos: [...init.body.keys()].filter((k: string) => k.startsWith("files[")).map((k: string) => (init.body.get(k) as File).name) });
      else recibidos.push({ url, cuerpo: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as unknown as typeof fetch;
    return { f, recibidos };
  }
  const configurar = (cambios: object) => uno("select gestionar_informe($1::jsonb) as r", [JSON.stringify({ accion: "config", cambios })]);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10]);

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                     "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql",
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0022_mapa.sql", "0024_perfil_subasta.sql", "0025_oportunidades.sql",
                     "0026_region.sql", "0028_recetas_tsm.sql", "0029_mapa_casa.sql", "0030_listas_alertas.sql", "0038_planes_a_medida.sql",
                     "0039_cantidades_ahledger.sql", "0042_datos_fabricacion.sql", "0045_sniper.sql", "0047_sniper_apariencia.sql",
                     "0048_sniper_tarjeta.sql", "0049_informe_diario.sql", "0051_informe_paginas.sql", "0052_informe_pociones.sql"]) await pg.exec(leer(n));
    const cat = [[1, "Peacebloom", "Trade Goods", "Herb"], [2, "Mechanical Squirrel Box", "Miscellaneous", "Pet"],
                 [3, "Arcane Crystal", "Trade Goods", "Metal & Stone"], [4, "Thorium Bar", "Trade Goods", "Metal & Stone"],
                 [5, "Runecloth", "Trade Goods", "Cloth"]]
      .map(([id, name, itemClass, itemSubclass]) => ({ id, name, itemClass, itemSubclass, quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    // 7 días de historial cada hora. Hierba estable a 100; mascota 1000 → 2000 en las últimas 24 h; cristal a 5000
    // con un anuncio suelto a 2000 en el último escaneo (ganga); barra 800 → 400; tela estable.
    const fin = Date.parse("2026-11-24T12:00:00Z");
    for (let t = fin - 7 * 24 * H; t <= fin; t += H) {
      const reciente = t > fin - 24 * H;
      await escaneo(t, [
        [1, 100, 500, 40, 100],
        [2, reciente ? 2000 : 1000, 10, 2, 1200],
        [3, t === fin ? 2000 : 5000, 20, 5, 5000],
        [4, reciente ? 400 : 800, 50, 10, 700],
        [5, 300, 200, 30, 300],
      ]);
    }
    // Un escaneo incompleto (solo un objeto): no debe contar.
    await pg.query("delete from price_hourly where hour = $1::timestamptz and item_id <> 1", [new Date(fin - 5 * H).toISOString()]);
    await uno("select gestionar_sniper($1::jsonb) as r", [JSON.stringify({ accion: "webhook_alta", nombre: "Informes", url: URL_WH })]);
  });

  test("informe_base: 48 h, horas incompletas marcadas y precios por objeto", async () => {
    const b = (await uno("select informe_base($1, $2::timestamptz) as r", [AHL, AHORA.toISOString()])).r;
    assert.equal(b.mercado.proveedor, "ahledger");
    assert.equal(b.serie.length, 48);
    assert.equal(b.serie.filter((s: any) => !s[3]).length, 1);          // el escaneo incompleto
    const mascota = b.objetos.find((o: any) => o[0] === 2);
    assert.deepEqual([mascota[1], mascota[2], mascota[13]], [2000, 1000, "mascotas"]);
    assert.equal(b.objetos.find((o: any) => o[0] === 4)[13], "barras");
    assert.equal(b.objetos.find((o: any) => o[0] === 3)[13], "minerales");
  });

  test("análisis con datos conocidos: subidas, caídas, ganga, categorías; nada inventado", async () => {
    const b = (await uno("select informe_base($1, $2::timestamptz) as r", [AHL, AHORA.toISOString()])).r;
    const ref7 = (await uno("select informe_ref7($1, array[3], $2::timestamptz) as r", [AHL, AHORA.toISOString()])).r;
    const inf: any = analizarInforme(b, { config: { neta_min: 100, liquidez_min: 0.5 }, ref7, zona: "UTC", ahora: AHORA.getTime() });
    assert.deepEqual(inf.subidas.map((x: any) => [x.id, Math.round(x.pct)]), [[2, 100]]);
    assert.deepEqual(inf.caidas.map((x: any) => [x.id, Math.round(x.pct)]), [[4, -50]]);
    assert.equal(inf.gangas[0].id, 3);
    assert.equal(Math.round(inf.gangas[0].descuento), 60);              // 2000 frente a 5000
    assert.equal(inf.gangas[0].reventa, 4750);                         // 5000 − 5 %
    assert.equal(inf.categorias.find((c: any) => c.clave === "mascotas").variacion, null);   // un solo objeto: sin datos
    assert.equal(inf.categorias.find((c: any) => c.clave === "general").total, 5);
    assert.equal(inf.arbitraje.disponible, false);                     // no hay datos de la Alianza
    assert.equal(inf.kpi.escaneos, 23);                                // 24 h menos el incompleto
    assert.equal(inf.crafteos.length, 0);
    completarInforme(inf, { 2: { n: "Caja de ardilla", i: null, q: "COMMON" } });
    assert.match(inf.resumen, /1 ganga de reventa y 0 crafteos rentables/);
    assert.equal(inf.destacados[0].cifra, "2×");
    // Páginas apaisadas de 800 × 600 (4:3): una por embed de Discord.
    assert.deepEqual(paginasInforme(inf), ["resumen", "oro", "cambios", "gangas", "crafteos", "categorias", "destacados"]);
    const pag = (p: string) => informeSVG(inf, { pagina: p, sitio: "https://mercadowow.vercel.app" });
    assert.deepEqual([pag("resumen").ancho, pag("resumen").alto], [800, 600]);
    assert.match(pag("resumen").svg, /Informe diario del mercado/);
    assert.match(pag("destacados").svg, /solo se registran precios de la casa de Horda/);
    assert.match(pag("crafteos").svg, /Ningún crafteo cumple/);
    assert.match(pag("oro").svg, /POCIONES Y ELIXIRES MÁS VENDIDOS/);
    assert.match(pag("oro").svg, /Sin estimaciones de ventas de pociones ni elixires/);   // el catálogo de prueba no tiene
    assert.match(pag("gangas").svg, /Prices from AHledger/);
    // Sin secciones de gangas ni crafteos, sus páginas desaparecen.
    assert.deepEqual(paginasInforme({ ...inf, config: { ...inf.config, secciones: { gangas: false, crafteos: false } } }),
      ["resumen", "oro", "cambios", "categorias", "destacados"]);
  });

  test("pociones y elixires más vendidos: sin comida ni otros consumibles", async () => {
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify([
      { id: 6, name: "Major Healing Potion", itemClass: "Consumable", itemSubclass: "Potions", quality: "COMMON" },
      { id: 7, name: "Elixir of the Mongoose", itemClass: "Consumable", itemSubclass: "Elixirs", quality: "COMMON" },
      { id: 8, name: "Roast Raptor", itemClass: "Consumable", itemSubclass: "Food & Drink", quality: "COMMON" },
      { id: 9, name: "Flask of the Titans", itemClass: "Consumable", itemSubclass: "Flasks", quality: "COMMON" }])]);
    const fin = Date.parse("2026-11-24T12:00:00Z");
    for (let t = fin - 6 * H; t <= fin; t += H) await escaneo(t, [[6, 500, 40, 30, 500], [7, 800, 30, 12, 800], [8, 50, 900, 900, 50], [9, 9000, 5, 8, 9000]]);
    const b = (await uno("select informe_base($1, $2::timestamptz) as r", [AHL, AHORA.toISOString()])).r;
    assert.equal(b.objetos.find((o: any) => o[0] === 8)[14], "Food & Drink");
    assert.equal(b.objetos.find((o: any) => o[0] === 1)[14], null);   // no es un consumible
    const inf: any = analizarInforme(b, { zona: "UTC", ahora: AHORA.getTime() });
    // La comida (900/día) y el frasco quedan fuera; ordenadas por ventas al día.
    assert.deepEqual(inf.consumibles.map((x: any) => x.id), [6, 7]);
  });

  test("enviar: guarda el informe, adjunta la imagen y la muestra en el embed; la URL no sale", async () => {
    await configurar({ zona: "America/Santiago", neta_min: 100 });
    const d = discord();
    const pedidas: number[] = [];
    const r = await ejecutarInforme(db, { fetch: d.f, modo: "enviar", ahora: () => AHORA, espera: sinEspera,
                                          renderizar: async (id, pagina) => { pedidas.push(id); return pagina === "categorias" ? null : png; } });
    assert.equal(r.estado, "ok");
    assert.equal(d.recibidos.length, 1);
    const c = d.recibidos[0].cuerpo;
    assert.equal(c.username, "MercadoWoW | Market Intelligence");
    assert.equal(c.embeds[0].title, "Informe diario del mercado");
    // Una imagen por página (la que no se pudo dibujar se omite); la primera, mercadowow-report.png.
    assert.equal(c.embeds.length, 6);
    assert.equal(c.embeds[0].image.url, "attachment://mercadowow-report.png");
    assert.equal(c.embeds[1].image.url, "attachment://mercadowow-report-2.png");
    assert.equal(c.embeds[1].url, undefined);                          // sin enlace: Discord no las junta en galería
    assert.deepEqual(d.recibidos[0].archivos, c.attachments.map((a: any) => a.filename));
    assert.equal(c.attachments[0].filename, "mercadowow-report.png");
    assert.ok(c.embeds.every((e: any) => e.color === 0xE9BC65));
    assert.match(c.embeds.at(-1).footer.text, /Prices from AHledger/);
    assert.equal(c.embeds[0].footer, undefined);
    assert.deepEqual(new Uint8Array(await d.recibidos[0].archivo!.arrayBuffer()), png);
    const est = (await uno("select informe_estado() as r")).r;
    assert.deepEqual([est.historial[0].estado, est.historial[0].tipo, est.historial[0].enviados], ["enviado", "manual", 1]);
    assert.match(est.historial[0].error, /1 página\(s\) sin imagen/);
    assert.equal(est.ultimo.id, pedidas[0]);
    assert.equal(JSON.stringify(est).includes("BBBBBBBB"), false);
    // Sin imagen no se envía: queda como error.
    const d2 = discord();
    const r2 = await ejecutarInforme(db, { fetch: d2.f, modo: "enviar", ahora: () => AHORA, espera: sinEspera, renderizar: async () => null });
    assert.equal(r2.estado, "error");
    assert.equal(d2.recibidos.length, 0);
  });

  test("automático: solo a su hora, una vez al día y con reintentos limitados", async () => {
    await configurar({ activo: true, hora: 13, zona: "UTC" });
    const d = discord();
    assert.equal((await ejecutarInforme(db, { fetch: d.f, ahora: () => AHORA, espera: sinEspera, renderizar: async () => png })).estado, "no_toca");
    const despues = () => new Date("2026-11-24T13:10:00Z");
    assert.equal((await uno("select informe_toca($1::timestamptz) as r", [despues().toISOString()])).r, true);
    assert.equal((await ejecutarInforme(db, { fetch: d.f, ahora: despues, espera: sinEspera, renderizar: async () => png })).estado, "ok");
    assert.equal(d.recibidos.length, 1);
    assert.equal((await uno("select informe_toca($1::timestamptz) as r", [new Date("2026-11-24T20:00:00Z").toISOString()])).r, false);
    // Al día siguiente vuelve a tocar.
    assert.equal((await uno("select informe_toca($1::timestamptz) as r", [new Date("2026-11-25T13:20:00Z").toISOString()])).r, true);
    // Tres fallos seguidos: deja de intentarlo ese día.
    for (const m of [20, 45, 70]) {
      const t = new Date(Date.parse("2026-11-25T13:00:00Z") + m * 60e3);
      await ejecutarInforme(db, { fetch: d.f, ahora: () => t, espera: sinEspera, renderizar: async () => null });
    }
    assert.equal((await uno("select informe_toca($1::timestamptz) as r", [new Date("2026-11-25T16:00:00Z").toISOString()])).r, false);
  });

  test("prueba del webhook y validación de la configuración", async () => {
    const est = (await uno("select informe_estado() as r")).r;
    const d = discord();
    assert.equal((await ejecutarInforme(db, { fetch: d.f, modo: "prueba", webhook: est.webhooks[0].id, espera: sinEspera })).estado, "ok");
    assert.match(d.recibidos[0].cuerpo.embeds[0].title, /Prueba/);
    await assert.rejects(configurar({ zona: "Marte/Base" }), /Zona horaria/);
    await assert.rejects(configurar({ hora: 25 }), /no válido/);
    await assert.rejects(configurar({ secciones: { brillo: true } }), /Sección desconocida/);
    await assert.rejects(configurar({ secciones: { comerciados: false } }), /Sección desconocida/);   // sustituida por «consumibles»
    await assert.rejects(configurar({ nombre: "Discord bot" }), /no permite/);
    await assert.rejects(configurar({ webhooks: [999] }), /Webhook desconocido/);
    await assert.rejects(configurar({ market_key: "no:existe" }), /Mercado desconocido/);
    const r = (await configurar({ secciones: { arbitraje: false }, por_seccion: 3, webhooks: [est.webhooks[0].id] })).r;
    assert.deepEqual([r.config.secciones, r.config.por_seccion, r.config.webhooks], [{ arbitraje: false }, 3, [est.webhooks[0].id]]);
  });
});
