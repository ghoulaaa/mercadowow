// Tarea «sniper» de la Edge Function: analiza las recetas con los precios del último escaneo y avisa por
// Discord de las oportunidades que cumplen la configuración, sin repetir las ya avisadas.
// El cálculo es el de la página (motor/*.js, copiado de app/static con npm run motor).
// Seguridad: la URL del webhook solo se lee aquí (servidor) y nunca se escribe en registros ni errores.

import { calcularFilas } from "./motor/fabricacion_tabla.js";
import { REGLA_POR_DEFECTO } from "./motor/fabricacion.js";
import { partesTarjeta } from "./motor/tarjeta.js";
import {
  ARCHIVOS_TARJETA, claveOportunidad, decidirEnvio, evaluar, evaluarFila, mencionPara, mensajeDiscord, mensajePrueba, mensajeTarjeta,
  normalizarConfig,
} from "./motor/sniper.js";
import type { Db } from "./nucleo.ts";

export interface OpcionesSniper {
  fetch: typeof fetch;
  modo?: "auto" | "analizar" | "prueba" | "manual";
  webhook?: number;
  spell?: number;
  ahora?: () => Date;
  espera?: (ms: number) => Promise<void>;
  /** Dibuja la tarjeta PNG de una oportunidad (por defecto: otra petición a esta Edge Function). null = sin imagen. */
  renderizar?: (o: unknown, opciones: unknown) => Promise<Uint8Array | null>;
}

async function uno(db: Db, sql: string, params: unknown[] = []): Promise<any> {
  const r = (await db.consulta(sql, params))[0]?.r;
  return typeof r === "string" ? JSON.parse(r) : r;
}

export interface ResultadoEnvio { ok: boolean; error?: string; limite?: boolean }
export interface Archivo { nombre: string; datos: Uint8Array }

/**
 * Envía un mensaje a un webhook de Discord. Respeta el límite: con 429 espera lo que pide Discord (hasta 10 s)
 * y reintenta una vez; con un fallo de red o 5xx, reintenta una vez. Los errores nunca incluyen la URL.
 */
export async function enviarDiscord(f: typeof fetch, url: string | null, cuerpo: unknown,
                                    espera: (ms: number) => Promise<void>, archivos: Archivo[] | null = null): Promise<ResultadoEnvio> {
  if (!url) return { ok: false, error: "No se pudo leer el webhook" };
  const destino = url + (url.includes("?") ? "&" : "?") + "wait=true";
  for (let intento = 0; intento < 2; intento++) {
    let r: Response;
    try {
      if (archivos?.length) {
        // Con imágenes: multipart (payload_json + files[i]); cada embed muestra la suya con attachment://.
        const fd = new FormData();
        fd.append("payload_json", JSON.stringify(cuerpo));
        archivos.forEach((a, i) => fd.append(`files[${i}]`, new Blob([a.datos], { type: "image/png" }), a.nombre));
        r = await f(destino, { method: "POST", body: fd });
      } else {
        r = await f(destino, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      }
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
  wowhead: o.wowhead, stockSubasta: o.stockSubasta, deposito: o.deposito, equilibrio: o.equilibrio, competencia: o.competencia,
  materiales: o.materiales.map((m: any) => ({ id: m.id, nombre: m.nombre, cantidad: m.cantidad, precioUnitario: m.precioUnitario,
    costeTotal: m.costeTotal, origen: m.origen, sinOfertas: m.sinOfertas, icono: m.icono, disponible: m.disponible })),
  avisos: o.avisos, bloquea: o.bloquea, motivoDescarte: o.motivoDescarte ?? null,
});

/**
 * Pide la tarjeta PNG a esta misma Edge Function ({tarea: "tarjeta"}), en otra petición: así cada tarjeta tiene
 * su propio tiempo de CPU. Lleva el token interno; sin dirección o token, o si falla, null (se envía el texto).
 */
function renderizarRemoto(db: Db, f: typeof fetch) {
  let conf: Promise<{ url: string; token: string } | null> | null = null;
  return async (o: unknown, opciones: unknown): Promise<Uint8Array | null> => {
    conf ??= (async () => {
      try {
        const url = (await db.consulta("select sniper_url_funcion() as r", []))[0]?.r;
        const token = (await db.consulta("select sniper_token() as r", []))[0]?.r;
        return typeof url === "string" && typeof token === "string" ? { url, token } : null;
      } catch { return null; }
    })();
    const c = await conf;
    if (!c) return null;
    try {
      const r = await f(c.url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarea: "tarjeta", token: c.token, o, opciones }), signal: AbortSignal.timeout(60_000) });
      if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) return null;
      return new Uint8Array(await r.arrayBuffer());
    } catch { return null; }
  };
}

export async function ejecutarSniper(db: Db, op: OpcionesSniper) {
  const ahora = op.ahora ?? (() => new Date());
  const espera = op.espera ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const modo = op.modo ?? "auto";
  // Un solo análisis a la vez y nunca a la vez que el informe diario (turno compartido; caduca solo a los 4 min
  // si algo se interrumpe). Lo automático lo intenta en la siguiente vuelta; lo pedido desde la página espera
  // hasta 45 s a que el otro termine.
  const tomar = () => uno(db, "select sniper_tomar_turno(240, $1::timestamptz) as r", [ahora().toISOString()]);
  let turno = await tomar();
  for (let i = 0; !turno && modo !== "auto" && i < 9; i++) { await espera(5000); turno = await tomar(); }
  if (!turno) return { estado: "ocupado" };
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

    // Mensaje de una oportunidad: tarjeta PNG (una sola vez, aunque vaya a varios webhooks) o, con el estilo
    // «texto» o si la tarjeta no se pudo dibujar, el embed de texto.
    const proveedor = est.mercados?.find((m: any) => m.key === cfg.market_key)?.proveedor ?? "tsm";
    const renderizar = op.renderizar ?? renderizarRemoto(db, op.fetch);
    const preparar = async (o: any, { manual = false, motivo = null as string | null, mencion = null as string | null } = {}) => {
      const ap = cfg.apariencia;
      const base = { sitio: cfg.sitio_url, ahora: ahora().getTime(), manual, mencion, apariencia: ap };
      const texto = () => ({ cuerpo: mensajeDiscord(o, { ...base, mercado, motivo }), archivos: null as Archivo[] | null, tarjeta: false });
      if (ap.estilo !== "tarjeta") return texto();
      try {
        const serie = ap.grafico
          ? await uno(db, "select sniper_serie($1, $2::integer, $3::integer, $4::timestamptz) as r", [cfg.market_key, o.id, ap.periodo, ahora().toISOString()])
          : null;
        // Cada tarjeta en su propia petición (en paralelo). Sin resumen → texto; sin detalle → solo el resumen.
        const pedidas = partesTarjeta(o, ap);
        const pngs = await Promise.all(pedidas.map((parte) =>
          renderizar(o, { apariencia: ap, mercado, proveedor, serie, ahora: ahora().getTime(), manual, sitio: cfg.sitio_url, parte }).catch(() => null)));
        if (!pngs[0]) return texto();
        const partes = pedidas.filter((_, i) => pngs[i]);
        const archivos = partes.map((p) => ({ nombre: ARCHIVOS_TARJETA[p as keyof typeof ARCHIVOS_TARJETA], datos: pngs[pedidas.indexOf(p)]! }));
        return { cuerpo: mensajeTarjeta(o, { ...base, partes }), archivos, tarjeta: true };
      } catch {
        return texto();
      }
    };

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
      const msg = await preparar(o, { manual: true, motivo: "Envío manual desde MercadoWoW" });
      for (const w of destinos) {
        const res = await enviarDiscord(op.fetch, await urlDe(w.id), msg.cuerpo, espera, msg.archivos);
        avisos.push({ clave: claveOportunidad(cfg.market_key, o.spell), market_key: cfg.market_key, spell: o.spell, item_id: o.id,
                      webhook_id: w.id, tipo: "manual", estado: res.ok ? "enviado" : "error", motivo: "Envío manual", clase: o.clase,
                      score: o.score, neta: o.neta, coste: o.coste, roi: o.roi, datos: { nombre: o.nombre, icono: o.icono, tarjeta: msg.tarjeta },
                      error: res.error ?? null });
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
        const msg = await preparar(o, { motivo: d.motivo, mencion: mencionPara(o, cfg) });
        for (const w of destinos) {
          const res = await enviarDiscord(op.fetch, await urlDe(w.id), msg.cuerpo, espera, msg.archivos);
          avisos.push({ clave, market_key: cfg.market_key, spell: o.spell, item_id: o.id, webhook_id: w.id, tipo: "auto",
                        estado: res.ok ? "enviado" : "error", motivo: d.motivo, clase: o.clase, score: o.score, neta: o.neta,
                        coste: o.coste, roi: o.roi, datos: { nombre: o.nombre, icono: o.icono, tarjeta: msg.tarjeta }, error: res.error ?? null });
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
