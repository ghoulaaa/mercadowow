// Tarea «sniper» de la Edge Function: analiza las recetas con los precios del último escaneo y avisa por
// Discord de las oportunidades que cumplen la configuración, sin repetir las ya avisadas.
// El cálculo es el de la página (motor/*.js, copiado de app/static con npm run motor).
// Seguridad: la URL del webhook solo se lee aquí (servidor) y nunca se escribe en registros ni errores.

import { calcularFilas } from "./motor/fabricacion_tabla.js";
import { REGLA_POR_DEFECTO } from "./motor/fabricacion.js";
import {
  claveOportunidad, decidirEnvio, evaluar, evaluarFila, mencionPara, mensajeDiscord, mensajePrueba, normalizarConfig,
} from "./motor/sniper.js";
import type { Db } from "./nucleo.ts";

export interface OpcionesSniper {
  fetch: typeof fetch;
  modo?: "auto" | "analizar" | "prueba" | "manual";
  webhook?: number;
  spell?: number;
  ahora?: () => Date;
  espera?: (ms: number) => Promise<void>;
}

async function uno(db: Db, sql: string, params: unknown[] = []): Promise<any> {
  const r = (await db.consulta(sql, params))[0]?.r;
  return typeof r === "string" ? JSON.parse(r) : r;
}

export interface ResultadoEnvio { ok: boolean; error?: string; limite?: boolean }

/**
 * Envía un mensaje a un webhook de Discord. Respeta el límite: con 429 espera lo que pide Discord (hasta 10 s)
 * y reintenta una vez; con un fallo de red o 5xx, reintenta una vez. Los errores nunca incluyen la URL.
 */
export async function enviarDiscord(f: typeof fetch, url: string | null, cuerpo: unknown,
                                    espera: (ms: number) => Promise<void>): Promise<ResultadoEnvio> {
  if (!url) return { ok: false, error: "No se pudo leer el webhook" };
  const destino = url + (url.includes("?") ? "&" : "?") + "wait=true";
  for (let intento = 0; intento < 2; intento++) {
    let r: Response;
    try {
      r = await f(destino, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    } catch {
      if (intento) return { ok: false, error: "Sin conexión con Discord" };
      await espera(1000);
      continue;
    }
    if (r.ok) return { ok: true };
    if (r.status === 429) {
      const j = await r.json().catch(() => ({})) as { retry_after?: number };
      const s = Number(j.retry_after ?? r.headers.get("retry-after") ?? 1);
      if (intento || !(s <= 10)) return { ok: false, error: `Discord pide esperar ${Math.ceil(s)} s (demasiadas peticiones)`, limite: true };
      await espera(Math.ceil(s * 1000));
      continue;
    }
    if (r.status >= 500 && !intento) { await espera(1000); continue; }
    const texto = (await r.text().catch(() => "")).replace(/https?:\/\/\S+/g, "[url]").slice(0, 200);
    return { ok: false, error: `Discord respondió ${r.status}${r.status === 404 ? " (el webhook no existe o se borró)" : ""}${texto ? `: ${texto}` : ""}` };
  }
  return { ok: false, error: "Discord no respondió" };
}

/** Webhooks activos que reciben una profesión (sin profesiones elegidas: todas). */
const destinosDe = (o: { profesion: string }, webhooks: any[]) =>
  webhooks.filter((w) => w.activo && (!w.profesiones?.length || w.profesiones.includes(o.profesion)));

/** Lo que se guarda de cada oportunidad para el panel (sin repetir todo el cálculo). */
const resumen = (o: any) => ({
  spell: o.spell, id: o.id, nombre: o.nombre, icono: o.icono, calidad: o.calidad, profesion: o.profesion, nivel: o.nivel,
  unidades: o.unidades, coste: o.coste, ingresoBruto: o.ingresoBruto, precioVenta: o.precioVenta, comision: o.comision, neta: o.neta,
  roi: o.roi, margen: o.margen, score: o.score, partes: o.partes, riesgo: o.riesgo, confianza: o.confianza, clase: o.clase,
  ventas: o.ventas, regional: o.regional, maxFabricable: o.maxFabricable, stockIlimitado: o.stockIlimitado, conservador: o.conservador, historico: o.historico,
  wowhead: o.wowhead, materiales: o.materiales.map((m: any) => ({ id: m.id, nombre: m.nombre, cantidad: m.cantidad, costeTotal: m.costeTotal, origen: m.origen, sinOfertas: m.sinOfertas })),
  avisos: o.avisos, bloquea: o.bloquea, motivoDescarte: o.motivoDescarte ?? null,
});

export async function ejecutarSniper(db: Db, op: OpcionesSniper) {
  const ahora = op.ahora ?? (() => new Date());
  const espera = op.espera ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const modo = op.modo ?? "auto";
  // Un solo análisis a la vez (el turno caduca solo a los 4 min si algo se interrumpe).
  if (!(await uno(db, "select sniper_tomar_turno(240, $1::timestamptz) as r", [ahora().toISOString()]))) {
    return { estado: "ocupado" };
  }
  try {
    const est = await uno(db, "select sniper_estado() as r");
    const cfg = normalizarConfig(est.config);
    const mercado = est.mercados?.find((m: any) => m.key === cfg.market_key)?.nombre ?? cfg.market_key;
    const registrar = (avisos: unknown[], vigentes: string[] | null, resultado: unknown, escaneo: string | null) =>
      db.consulta("select sniper_registrar($1::text::jsonb, case when $2::text is null then null else array(select jsonb_array_elements_text($2::text::jsonb)) end, $3::text::jsonb, $4::timestamptz, $5::timestamptz)",
        [JSON.stringify(avisos), vigentes == null ? null : JSON.stringify(vigentes), resultado == null ? null : JSON.stringify(resultado),
         escaneo, ahora().toISOString()]);
    // Texto, no JSON: se lee tal cual (y solo vive en esta variable mientras se envía).
    const urlDe = async (id: number) => {
      const r = (await db.consulta("select sniper_webhook_url($1::integer) as r", [id]))[0]?.r;
      return typeof r === "string" ? r : null;
    };

    // ---- prueba: comprueba la conexión, sin cifras.
    if (modo === "prueba") {
      const w = est.webhooks.find((x: any) => x.id === op.webhook);
      if (!w) return { estado: "sin_webhook" };
      const res = await enviarDiscord(op.fetch, await urlDe(w.id), mensajePrueba({ sitio: cfg.sitio_url, ahora: ahora().getTime(), apariencia: cfg.apariencia }), espera);
      await registrar([{ clave: "prueba", market_key: cfg.market_key, webhook_id: w.id, tipo: "prueba",
                         estado: res.ok ? "enviado" : "error", motivo: "Notificación de prueba", error: res.error ?? null }], null, null, null);
      return { estado: res.ok ? "ok" : "error", error: res.error };
    }

    const activos = est.webhooks.filter((w: any) => w.activo);
    if (modo === "auto" && (!cfg.activo || !activos.length)) return { estado: "inactivo" };

    const datos = await uno(db, "select datos_fabricacion($1) as r", [cfg.market_key]);
    // Historial solo de los productos que ganan algo (los únicos que pueden avisarse).
    const filas = calcularFilas(datos, { regla: { ...REGLA_POR_DEFECTO, comision_pct: Number(cfg.comision_pct) } });
    const ids = [...new Set(filas.filter((x: any) => x.completo && x.neta > 0).map((x: any) => x.id))];
    const hist = ids.length
      ? await uno(db, "select sniper_historial($1, array(select (jsonb_array_elements_text($2::text::jsonb))::integer), $3::timestamptz) as r",
                  [cfg.market_key, JSON.stringify(ids), ahora().toISOString()]) ?? {}
      : {};

    // ---- envío manual de una receta (desde la página), aunque no pase los filtros: se avisa de su riesgo.
    if (modo === "manual") {
      const x = filas.find((f: any) => f.spell === op.spell);
      if (!x || !x.completo || x.neta == null) {
        await registrar([{ clave: claveOportunidad(cfg.market_key, op.spell ?? 0), market_key: cfg.market_key, spell: op.spell ?? null,
                           tipo: "manual", estado: "omitido", motivo: "La receta no tiene todos los precios", error: null }], null, null, null);
        return { estado: "incompleta" };
      }
      const o = evaluarFila(x, datos, hist[x.id] ?? null, cfg, ahora().getTime());
      const destinos = op.webhook ? est.webhooks.filter((w: any) => w.id === op.webhook) : destinosDe(o, activos);
      if (!destinos.length) return { estado: "sin_webhook" };
      const avisos = [];
      for (const w of destinos) {
        const res = await enviarDiscord(op.fetch, await urlDe(w.id),
          mensajeDiscord(o, { sitio: cfg.sitio_url, mercado, ahora: ahora().getTime(), manual: true, motivo: "Envío manual desde MercadoWoW", apariencia: cfg.apariencia }), espera);
        avisos.push({ clave: claveOportunidad(cfg.market_key, o.spell), market_key: cfg.market_key, spell: o.spell, item_id: o.id,
                      webhook_id: w.id, tipo: "manual", estado: res.ok ? "enviado" : "error", motivo: "Envío manual", clase: o.clase,
                      score: o.score, neta: o.neta, coste: o.coste, roi: o.roi, datos: { nombre: o.nombre, icono: o.icono }, error: res.error ?? null });
      }
      await registrar(avisos, null, null, null);
      return { estado: avisos.every((a) => a.estado === "enviado") ? "ok" : "error", avisos: avisos.length };
    }

    // ---- análisis (automático o «Analizar ahora»).
    const ev = evaluar(datos, hist, cfg, ahora().getTime());
    const claves = ev.oportunidades.map((o: any) => claveOportunidad(cfg.market_key, o.spell));
    const previos = claves.length
      ? await uno(db, "select sniper_previos(array(select jsonb_array_elements_text($1::text::jsonb))) as r", [JSON.stringify(claves)]) ?? {}
      : {};
    const avisos: any[] = [];
    let enviadas = 0, limite = false;
    // Solo se envía con el sniper activo (con «Analizar ahora» y el sniper parado, solo se actualiza el panel).
    if (cfg.activo) {
      for (const o of ev.oportunidades) {
        if (enviadas >= cfg.max_por_ronda || limite) break;
        const clave = claveOportunidad(cfg.market_key, o.spell);
        const d = decidirEnvio(o, previos[clave] ?? null, cfg, ahora().getTime());
        if (!d.enviar) continue;
        const destinos = destinosDe(o, activos);
        if (!destinos.length) continue;
        const cuerpo = mensajeDiscord(o, { sitio: cfg.sitio_url, mercado, ahora: ahora().getTime(), motivo: d.motivo, mencion: mencionPara(o, cfg), apariencia: cfg.apariencia });
        for (const w of destinos) {
          const res = await enviarDiscord(op.fetch, await urlDe(w.id), cuerpo, espera);
          avisos.push({ clave, market_key: cfg.market_key, spell: o.spell, item_id: o.id, webhook_id: w.id, tipo: "auto",
                        estado: res.ok ? "enviado" : "error", motivo: d.motivo, clase: o.clase, score: o.score, neta: o.neta,
                        coste: o.coste, roi: o.roi, datos: { nombre: o.nombre, icono: o.icono }, error: res.error ?? null });
          if (res.limite) { limite = true; break; }
          await espera(700);   // Discord: unas 5 peticiones cada 2 s por webhook
        }
        enviadas++;
      }
    }
    const resultado = {
      recetas: ev.recetas, oportunidades: ev.oportunidades.length, escaneo: datos.escaneo,
      enviados: avisos.filter((a) => a.estado === "enviado").length, errores: avisos.filter((a) => a.estado === "error").length,
      limite, descartes: ev.descartes, activo: cfg.activo,
      top: ev.oportunidades.slice(0, 40).map(resumen),
      // Las que más ganarían pero no se avisan (para revisarlas a mano), con su motivo.
      revisar: ev.todas.filter((o: any) => o.motivoDescarte).sort((p: any, q: any) => q.neta - p.neta).slice(0, 15).map(resumen),
    };
    await registrar(avisos, claves, resultado, datos.escaneo);
    return { estado: "ok", recetas: ev.recetas, oportunidades: ev.oportunidades.length, enviados: resultado.enviados, errores: resultado.errores };
  } finally {
    await db.consulta("select sniper_soltar_turno()", []);
  }
}
