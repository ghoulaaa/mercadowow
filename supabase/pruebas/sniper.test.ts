// MercadoWoW Crafting Sniper: tarea de la Edge Function con Postgres simulado (PGlite) y un Discord falso.
// Comprueba el envío, que no se repite, el límite 429, la prueba, el envío manual, la protección contra
// falsas gangas, que la URL del webhook nunca sale de la base de datos y que el motor copiado está al día.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ejecutarSniper, enviarDiscord } from "../functions/actualizar-mercado/sniper.ts";
import type { Db } from "../functions/actualizar-mercado/nucleo.ts";
import { distintos } from "../sincronizar-motor.mjs";

const TSM = "tsm:forever:us:pvp-horde";
const URL_WH = "https://discord.com/api/webhooks/123456789012345678/" + "A".repeat(68);
const ULTIMO = "2026-11-24T14:00:00Z";
const ahora = () => new Date("2026-11-24T14:10:00Z");
const sinEspera = async () => {};

describe("sniper (SQL + tarea)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const db: Db = { consulta: async (q, p) => (await pg.query<any>(q, p as unknown[])).rows };

  // [id, compra mínima, valor de mercado, unidades, ventas/día] en un escaneo.
  async function escaneo(hora: string, filas: [number, number | null, number | null, number | null, number | null][]) {
    await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [TSM, hora]);
    for (const [id, min, valor, q, v] of filas) {
      await pg.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [TSM, id]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, quantity, sales_per_day, snapshot_id)
                      select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, $5::bigint, $6::integer, $7::numeric, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                       where m.key = $1`, [TSM, id, hora, min, valor, q, v]);
    }
  }
  // Discord falso: guarda lo recibido y responde lo que se le diga.
  function discord(respuestas: Response[] = []) {
    const recibidos: { url: string; cuerpo: any; archivo?: Blob }[] = [];
    const f = (async (url: string, init: any) => {
      if (init.body instanceof FormData) recibidos.push({ url, cuerpo: JSON.parse(String(init.body.get("payload_json"))), archivo: init.body.get("files[0]") as Blob });
      else recibidos.push({ url, cuerpo: JSON.parse(init.body) });
      return respuestas.shift() ?? new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as unknown as typeof fetch;
    return { f, recibidos };
  }
  const configurar = (cambios: object) => uno("select gestionar_sniper($1::jsonb) as r", [JSON.stringify({ accion: "config", cambios })]);

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
                     "0039_cantidades_ahledger.sql", "0042_datos_fabricacion.sql", "0045_sniper.sql", "0047_sniper_apariencia.sql", "0048_sniper_tarjeta.sql"]) await pg.exec(leer(n));
    const cat = [[2453, "Bruiseweed"], [3389, "Elixir of Defense"], [2589, "Linen Cloth"], [2580, "Wool Bandage"]]
      .map(([id, name]) => ({ id, name, itemClass: "Trade Goods", itemSubclass: "Herb", quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await uno(`select guardar_recetas('forever', 'Alchemy', $1::jsonb)`, [JSON.stringify([{
      spell_id: 3177, nombre: "Elixir of Defense", nivel_requerido: 130, obtencion: "trainer", resultado_id: 3389,
      resultado_nombre: "Elixir of Defense", cantidad_min: 1, cantidad_max: 1,
      reactivos: [{ item_id: 2453, nombre: "Bruiseweed", cantidad: 2 }] }])]);
    // Historial: 4 escaneos en 7 días con el elixir estable a ~2000 y 6 ventas al día.
    for (const [h, precio] of [["2026-11-20T14:00:00Z", 1950], ["2026-11-22T14:00:00Z", 2000], ["2026-11-23T14:00:00Z", 2050]] as const) {
      await escaneo(h, [[3389, precio, 2000, 20, 6], [2453, 400, 400, 300, 30]]);
    }
    await escaneo(ULTIMO, [[3389, 2000, 2000, 20, 6], [2453, 400, 400, 300, 30]]);   // coste 800, venta 2000
    await uno("select gestionar_sniper($1::jsonb) as r", [JSON.stringify({ accion: "webhook_alta", nombre: "Gangas", url: URL_WH })]);
    await configurar({ activo: true, roi_min: 30, neta_min: 100, score_min: 0, riesgo_max: "medio" });
  });

  test("la URL del webhook se valida y nunca sale de la base de datos (solo una pista)", async () => {
    await assert.rejects(uno("select gestionar_sniper($1::jsonb) as r", [JSON.stringify({ accion: "webhook_alta", url: "https://evil.example/api/webhooks/1/2" })]),
      /no es un webhook de Discord/);
    await assert.rejects(uno("select gestionar_sniper($1::jsonb) as r", [JSON.stringify({ accion: "webhook_alta", url: "http://discord.com/api/webhooks/123456789012345678/" + "A".repeat(68) })]),
      /no es un webhook de Discord/);
    const est = (await uno("select sniper_estado() as r")).r;
    assert.equal(JSON.stringify(est).includes("AAAAAAAAAA"), false);
    assert.equal(est.webhooks[0].pista, "discord.com/api/webhooks/1234…5678/••••");
    assert.equal((await uno("select sniper_webhook_url($1) as r", [est.webhooks[0].id])).r, URL_WH);
    // Validación de la configuración: umbrales en orden, mercado real, valores en rango.
    await assert.rejects(configurar({ umbrales: { rentable: 50, ganga: 30, epica: 60, legendaria: 100, excepcional: 200 } }), /de menor a mayor/);
    await assert.rejects(configurar({ market_key: "no:existe" }), /Mercado desconocido/);
    await assert.rejects(configurar({ score_min: 500 }), /no válido/);
  });

  test("avisa una vez de una oportunidad real, con sus cifras, y no la repite", async () => {
    const d = discord();
    const r = await ejecutarSniper(db, { fetch: d.f, ahora, espera: sinEspera });
    assert.deepEqual([r.estado, r.enviados], ["ok", 1]);
    assert.equal(d.recibidos.length, 1);
    assert.match(d.recibidos[0].url, /\?wait=true$/);
    const e = d.recibidos[0].cuerpo.embeds[0];
    assert.equal(e.title, "Elixir of Defense");
    assert.equal(e.author.name, "GANGA LEGENDARIA");                 // ROI = (2000 − 100 − 800) / 800 = 137,5 % (100–200 %)
    const campo = (n: string) => e.fields.find((x: any) => x.name === n)?.value;
    assert.equal(campo("Fabricación"), "8s");
    assert.equal(campo("Beneficio neto"), "**+11s**");               // 2000 − 100 (5 %) − 800 = 1100 c
    assert.equal(campo("ROI"), "**138%**");                          // 137,5 % sin decimales, como en la página
    assert.equal(e.color, 0xFF8000);                                 // legendaria (100–200 %)
    assert.deepEqual(d.recibidos[0].cuerpo.allowed_mentions, { parse: [] });
    assert.equal(d.recibidos[0].cuerpo.username, "MercadoWoW");
    assert.match(e.thumbnail.url, /^https:\/\/render\.worldofwarcraft\.com\//);   // icono real (o el de respaldo)
    assert.match(e.fields.at(-1).value, /\[Wowhead\]\(https:\/\/www\.wowhead\.com\/forever\/item=3389\)/);
    // Segunda ronda con los mismos precios: no se repite.
    const d2 = discord();
    const r2 = await ejecutarSniper(db, { fetch: d2.f, ahora, espera: sinEspera });
    assert.deepEqual([r2.enviados, d2.recibidos.length], [0, 0]);
    const est = (await uno("select sniper_estado() as r")).r;
    assert.equal(est.avisos[0].estado, "enviado");
    assert.equal(est.config.ultimo_resultado.top[0].spell, 3177);
  });

  test("vuelve a avisar si la ganancia sube lo suficiente o si pasó el intervalo", async () => {
    await configurar({ apariencia: { modo: "detallado" } });   // el motivo del envío sale en el modo detallado
    await ejecutarSniper(db, { fetch: discord().f, ahora, espera: sinEspera });
    await escaneo("2026-11-24T15:00:00Z", [[3389, 2000, 2000, 20, 6], [2453, 250, 250, 300, 30]]);   // coste 800 → 500
    const d = discord();
    await ejecutarSniper(db, { fetch: d.f, ahora: () => new Date("2026-11-24T15:05:00Z"), espera: sinEspera });
    assert.equal(d.recibidos.length, 1);
    // ROI (2000 − 100 − 500) / 500 = 280 %: pasa de legendaria a excepcional (se comprueba antes que la ganancia).
    assert.match(d.recibidos[0].cuerpo.embeds[0].description, /Mejora su clasificación/);
    // Mismo escaneo una hora después: nada nuevo. Tras el intervalo de repetición (6 h): se repite.
    const d2 = discord();
    await ejecutarSniper(db, { fetch: d2.f, ahora: () => new Date("2026-11-24T16:05:00Z"), espera: sinEspera });
    assert.equal(d2.recibidos.length, 0);
    await escaneo("2026-11-24T21:00:00Z", [[3389, 2000, 2000, 20, 6], [2453, 250, 250, 300, 30]]);
    const d3 = discord();
    await ejecutarSniper(db, { fetch: d3.f, ahora: () => new Date("2026-11-24T21:10:00Z"), espera: sinEspera });
    assert.match(d3.recibidos[0]?.cuerpo.embeds[0].description ?? "", /intervalo de repetición/);
  });

  test("no avisa de falsas gangas: precio disparado frente a su mediana o escaneo viejo", async () => {
    await escaneo("2026-11-24T15:00:00Z", [[3389, 9000, 9000, 1, 6], [2453, 400, 400, 300, 30]]);   // 4,5 × la mediana
    const d = discord();
    const r = await ejecutarSniper(db, { fetch: d.f, ahora: () => new Date("2026-11-24T15:05:00Z"), espera: sinEspera });
    assert.equal(d.recibidos.length, 0);
    assert.equal(r.oportunidades, 0);
    const res = (await uno("select sniper_estado() as r")).r.config.ultimo_resultado;
    assert.match(res.revisar[0].bloquea.join(), /veces su mediana de 7 días/);
    // Escaneo de hace 5 horas: tampoco.
    const d2 = discord();
    await ejecutarSniper(db, { fetch: d2.f, ahora: () => new Date("2026-11-24T20:00:00Z"), espera: sinEspera });
    assert.equal(d2.recibidos.length, 0);
  });

  test("apariencia: se valida en SQL y cambia el mensaje (nombre, avatar, monedas, colores, secciones)", async () => {
    await assert.rejects(configurar({ apariencia: { nombre: "Discord bot" } }), /no permite/);
    await assert.rejects(configurar({ apariencia: { avatar: "http://x.com/a.png" } }), /https/);
    await assert.rejects(configurar({ apariencia: { emojis: { oro: ":oro:" } } }), /<:nombre:id>/);
    await assert.rejects(configurar({ apariencia: { colores: { ganga: "azul" } } }), /#RRGGBB/);
    await assert.rejects(configurar({ apariencia: { brillo: "rojo" } }), /desconocida/);
    await assert.rejects(configurar({ apariencia: { modo: "grande" } }), /Modo no válido/);
    const est = (await configurar({ score_min: 0, apariencia: { nombre: "Gangas WoW", avatar: "https://example.com/a.png", monedas: "opc",
      colores: { legendaria: "#123456" }, materiales: false, enlaces: false, imagen: false } })).r;
    assert.equal(est.config.score_min, 0);                           // el resto de la configuración también se guarda
    assert.equal(est.config.apariencia.nombre, "Gangas WoW");
    const d = discord();
    await ejecutarSniper(db, { fetch: d.f, ahora, espera: sinEspera });
    const c = d.recibidos[0].cuerpo, e = c.embeds[0];
    assert.deepEqual([c.username, c.avatar_url, e.color, e.thumbnail], ["Gangas WoW", "https://example.com/a.png", 0x123456, undefined]);
    assert.equal(e.fields.find((x: any) => x.name === "Fabricación").value, "8p");
    assert.equal(e.fields.some((x: any) => x.name === "Materiales" || x.name === "​"), false);
    // null devuelve una opción a su valor por defecto.
    assert.equal((await configurar({ apariencia: { nombre: null } })).r.config.apariencia.nombre, undefined);
  });

  test("tarjeta gráfica: se dibuja una vez, va adjunta (attachment://) con su historial real; si falla, texto", async () => {
    await configurar({ apariencia: { estilo: "tarjeta", periodo: 720 } });
    const pedidas: any[] = [];
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const d = discord();
    await ejecutarSniper(db, { fetch: d.f, ahora, espera: sinEspera, renderizar: async (o, op) => { pedidas.push({ o, op }); return png; } });
    assert.equal(pedidas.length, 1);
    assert.equal(pedidas[0].op.serie.length, 4);                     // los 4 escaneos reales del elixir (30 días)
    assert.equal(pedidas[0].op.proveedor, "tsm");
    const c = d.recibidos[0].cuerpo;
    assert.equal(c.embeds[0].image.url, "attachment://mercadowow-alert.png");
    assert.equal(c.attachments[0].filename, "mercadowow-alert.png");
    assert.match(c.embeds[0].description, /Wowhead Forever/);
    assert.equal(c.embeds[0].fields, undefined);                     // las cifras van en la imagen, no repetidas
    assert.deepEqual(new Uint8Array(await d.recibidos[0].archivo!.arrayBuffer()), png);
    // Si la tarjeta no se puede dibujar, se envía igual (en texto).
    const d2 = discord();
    await ejecutarSniper(db, { fetch: d2.f, ahora, espera: sinEspera, modo: "manual", spell: 3177, renderizar: async () => null });
    assert.equal(d2.recibidos[0].archivo, undefined);
    assert.ok(d2.recibidos[0].cuerpo.embeds[0].fields.length > 0);
    // Validación de las opciones nuevas.
    await assert.rejects(configurar({ apariencia: { periodo: 5 } }), /Período/);
    await assert.rejects(configurar({ apariencia: { zona: "Marte/Base" } }), /Zona horaria/);
    await assert.rejects(configurar({ apariencia: { ancho: 4000 } }), /Ancho/);
    assert.equal((await configurar({ apariencia: { zona: "America/Santiago", ancho: 1000 } })).r.config.apariencia.ancho, 1000);
  });

  test("inactivo no envía; «Analizar ahora» actualiza el panel sin enviar", async () => {
    await configurar({ activo: false });
    const d = discord();
    assert.equal((await ejecutarSniper(db, { fetch: d.f, ahora, espera: sinEspera })).estado, "inactivo");
    const r = await ejecutarSniper(db, { fetch: d.f, ahora, espera: sinEspera, modo: "analizar" });
    assert.deepEqual([r.oportunidades, r.enviados, d.recibidos.length], [1, 0, 0]);
  });

  test("Discord 429: espera lo que pide y reintenta una vez; los errores no incluyen la URL", async () => {
    let esperado = 0;
    const d = discord([new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 })]);
    await ejecutarSniper(db, { fetch: d.f, ahora, espera: async (ms) => { esperado += ms; } });
    assert.equal(d.recibidos.length, 2);
    assert.ok(esperado >= 1500);
    const r = await enviarDiscord((async () => new Response(`no existe ${URL_WH}`, { status: 404 })) as unknown as typeof fetch, URL_WH, {}, sinEspera);
    assert.equal(r.ok, false);
    assert.equal(r.error!.includes("AAAAAAAAAA"), false);
    assert.match(r.error!, /404/);
  });

  test("prueba y envío manual: sin cifras inventadas en la prueba; el manual se marca", async () => {
    const id = (await uno("select sniper_estado() as r")).r.webhooks[0].id;
    const d = discord();
    assert.equal((await ejecutarSniper(db, { fetch: d.f, ahora, espera: sinEspera, modo: "prueba", webhook: id })).estado, "ok");
    assert.equal(d.recibidos[0].cuerpo.embeds[0].title, "Notificación de prueba");
    assert.equal(JSON.stringify(d.recibidos[0].cuerpo).match(/\d+p\b/), null);
    const r = await ejecutarSniper(db, { fetch: d.f, ahora, espera: sinEspera, modo: "manual", spell: 3177 });
    assert.equal(r.estado, "ok");
    assert.match(d.recibidos[1].cuerpo.embeds[0].author.name, /ENVÍO MANUAL/);
    // La prueba no cuenta como análisis.
    assert.equal((await uno("select sniper_estado() as r")).r.config.ultimo_analisis, null);
  });

  test("un solo análisis a la vez", async () => {
    assert.equal((await uno("select sniper_tomar_turno(240) as r")).r, true);
    assert.equal((await ejecutarSniper(db, { fetch: discord().f, ahora, espera: sinEspera })).estado, "ocupado");
  });
});

test("el motor de la Edge Function es el mismo que el de la página (npm run motor)", () => {
  assert.deepEqual(distintos(), []);
});
