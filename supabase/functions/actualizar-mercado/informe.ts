// Tarea «informe» de la Edge Function: el informe diario del mercado (MercadoWoW · Market Intelligence).
//   modo "auto"    → la pide pg_cron (disparar_informe) cuando toca: calcula, guarda, dibuja y envía.
//   modo "generar" → «Generar informe ahora» de la página: calcula y guarda (vista previa), sin enviar.
//   modo "enviar"  → «Enviar informe a Discord»: calcula, guarda, dibuja y envía ahora.
//   modo "prueba"  → «Probar webhook»: un mensaje corto al webhook elegido.
// El análisis y el dibujo son los de app/static/informe.js (copiado con npm run motor): la vista previa de la
// página y la imagen de Discord salen del mismo código. La imagen se dibuja en otra petición ({tarea:
// "informe_png"}) para que tenga su propio tiempo de CPU. La URL del webhook solo se lee aquí, nunca sale.

import { analizarInforme, archivoPagina, candidatosGanga, completarInforme, diaLocal, idsInforme, mensajeInforme, mensajePruebaInforme,
  mercadoOpuesto, paginasInforme } from "./motor/informe.js";
import { evaluar } from "./motor/sniper.js";
import { calcularFilas } from "./motor/fabricacion_tabla.js";
import { REGLA_POR_DEFECTO } from "./motor/fabricacion.js";
import { enviarDiscord } from "./sniper.ts";
import type { Db } from "./nucleo.ts";

export interface OpcionesInforme {
  fetch: typeof fetch;
  modo?: "auto" | "generar" | "enviar" | "prueba";
  webhook?: number;
  ahora?: () => Date;
  espera?: (ms: number) => Promise<void>;
  /** Dibuja el PNG de una página de un informe guardado (por defecto: otra petición a esta Edge Function). null = sin imagen. */
  renderizar?: (id: number, pagina: string) => Promise<Uint8Array | null>;
}

async function uno(db: Db, sql: string, params: unknown[] = []): Promise<any> {
  const r = (await db.consulta(sql, params))[0]?.r;
  return typeof r === "string" ? JSON.parse(r) : r;
}
const lista = (ids: number[]) => JSON.stringify(ids);
const ARRAY = "array(select (jsonb_array_elements_text($ID::text::jsonb))::integer)";

/** Calcula el informe con los datos reales (sin guardarlo). */
export async function generarInforme(db: Db, cfg: any, ahora: Date, sitio = "") {
  const hasta = ahora.toISOString();
  const base = await uno(db, "select informe_base($1, $2::timestamptz) as r", [cfg.market_key, hasta]);
  const cands = candidatosGanga(base, cfg);
  const ref7 = cands.length
    ? await uno(db, `select informe_ref7($1, ${ARRAY.replace("$ID", "$2")}, $3::timestamptz) as r`, [cfg.market_key, lista(cands), hasta]) ?? {}
    : {};
  // Arbitraje: solo si se registra la otra facción (mismo juego, región, reglas y proveedor) con datos recientes.
  const mercados = await uno(db, `select coalesce(jsonb_agg(jsonb_build_object('key', key, 'proveedor', provider, 'faccion', faction,
                                    'reglas', ruleset, 'region', region, 'juego', game_type)), '[]'::jsonb) as r from markets where not is_demo`);
  const op = mercadoOpuesto(base.mercado, mercados ?? []);
  let otro = null;
  if (op) {
    const b = await uno(db, "select informe_base($1, $2::timestamptz) as r", [op.key, hasta]);
    if (b.serie.filter((s: any[]) => s[3] && s[0] > ahora.getTime() - 24 * 3600e3).length >= 3) otro = b;
  }
  // Crafteos: el mismo cálculo y las mismas protecciones que el Crafting Sniper.
  const datos = await uno(db, "select datos_fabricacion($1) as r", [cfg.market_key]);
  const filas = calcularFilas(datos, { regla: { ...REGLA_POR_DEFECTO } });
  const ids = [...new Set(filas.filter((x: any) => x.completo && x.neta > 0).map((x: any) => x.id))] as number[];
  const hist = ids.length
    ? await uno(db, `select sniper_historial($1, ${ARRAY.replace("$ID", "$2")}, $3::timestamptz) as r`, [cfg.market_key, lista(ids), hasta]) ?? {}
    : {};
  const ev = evaluar(datos, hist, { roi_min: Number(cfg.craft_roi_min), neta_min: Number(cfg.neta_min), score_min: 0,
                                    riesgo_max: "medio", edad_max_min: 180 }, ahora.getTime());
  const inf: any = analizarInforme(base, { config: cfg, ref7, crafteos: ev.oportunidades, otro, zona: cfg.zona, ahora: ahora.getTime() });
  const objetos = await uno(db, `select informe_objetos($1, ${ARRAY.replace("$ID", "$2")}) as r`, [base.mercado.juego ?? "forever", lista(idsInforme(inf))]);
  completarInforme(inf, objetos ?? {});
  inf.sitio = sitio;
  return inf;
}

/** Pide el PNG de una página de un informe guardado a esta misma Edge Function, con el token interno. null si falla. */
function renderizarRemoto(db: Db, f: typeof fetch) {
  return async (id: number, pagina: string): Promise<Uint8Array | null> => {
    try {
      const url = (await db.consulta("select sniper_url_funcion() as r", []))[0]?.r;
      const token = (await db.consulta("select sniper_token() as r", []))[0]?.r;
      if (typeof url !== "string" || typeof token !== "string") return null;
      const r = await f(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarea: "informe_png", token, id, pagina }), signal: AbortSignal.timeout(90_000) });
      if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) return null;
      return new Uint8Array(await r.arrayBuffer());
    } catch { return null; }
  };
}

export async function ejecutarInforme(db: Db, op: OpcionesInforme) {
  const ahora = op.ahora ?? (() => new Date());
  const espera = op.espera ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const modo = op.modo ?? "auto";
  const est = await uno(db, "select informe_estado() as r");
  const cfg = est.config;
  const sitio = est.sitio_url ?? "";
  const urlDe = async (id: number) => {
    const r = (await db.consulta("select sniper_webhook_url($1::integer) as r", [id]))[0]?.r;
    return typeof r === "string" ? r : null;
  };

  if (modo === "prueba") {
    const w = est.webhooks.find((x: any) => x.id === op.webhook);
    if (!w) return { estado: "sin_webhook" };
    const res = await enviarDiscord(op.fetch, await urlDe(w.id),
      mensajePruebaInforme({ sitio, nombre: cfg.nombre, avatar: cfg.avatar, ahora: ahora().getTime() }), espera);
    return { estado: res.ok ? "ok" : "error", error: res.error };
  }

  // El automático solo si toca (también se comprueba en pg_cron; aquí, por si la llamada llega dos veces).
  if (modo === "auto" && !(await uno(db, "select informe_toca($1::timestamptz) as r", [ahora().toISOString()]))) {
    return { estado: "no_toca" };
  }
  if (!(await uno(db, "select informe_tomar_turno(300, $1::timestamptz) as r", [ahora().toISOString()]))) {
    return { estado: "ocupado" };
  }
  const tipo = modo === "auto" ? "auto" : modo === "enviar" ? "manual" : "vista";
  const guardar = (fila: Record<string, unknown>) => uno(db, "select informe_guardar($1::text::jsonb) as r", [JSON.stringify(fila)]);
  const actualizar = (id: number, estado: string, enviados: number, error: string | null) =>
    db.consulta("select informe_actualizar($1::bigint, $2, $3::integer, $4)", [id, estado, enviados, error]);
  let id: number | null = null;
  try {
    const inf = await generarInforme(db, cfg, ahora(), sitio);
    const fila = { market_key: cfg.market_key, fecha: inf.fecha, desde: new Date(inf.desde).toISOString(),
                   hasta: new Date(inf.hasta).toISOString(), tipo, datos: inf };
    if (modo === "generar") {
      id = Number(await guardar({ ...fila, estado: "generado" }));
      return { estado: "ok", id };
    }
    const destinos = est.webhooks.filter((w: any) => w.activo && (!cfg.webhooks?.length || cfg.webhooks.includes(w.id)));
    if (!destinos.length) {
      id = Number(await guardar({ ...fila, estado: "error", error: "No hay webhooks activos elegidos para el informe" }));
      return { estado: "sin_webhook", id };
    }
    // Se guarda antes de dibujar: la imagen se dibuja a partir de los datos guardados.
    id = Number(await guardar({ ...fila, estado: "generado" }));
    // Una imagen por página (cada una en su propia petición, en paralelo). Sin la primera no se envía; si falla
    // otra, se envían las demás.
    const renderizar = op.renderizar ?? renderizarRemoto(db, op.fetch);
    const pedidas = paginasInforme(inf);
    const pngs = await Promise.all(pedidas.map((p: string) => renderizar(id!, p).catch(() => null)));
    if (!pngs[0]) {
      await actualizar(id, "error", 0, "No se pudo dibujar la imagen del informe");
      return { estado: "error", id, error: "No se pudo dibujar la imagen del informe" };
    }
    const paginas = pedidas.filter((_: string, i: number) => pngs[i]);
    const archivos = paginas.map((p: string, i: number) => ({ nombre: archivoPagina(i), datos: pngs[pedidas.indexOf(p)]! }));
    const cuerpo = mensajeInforme(inf, { sitio, nombre: cfg.nombre, avatar: cfg.avatar, manual: modo !== "auto", paginas });
    let ok = 0;
    const errores: string[] = [];
    for (const [i, w] of destinos.entries()) {
      if (i) await espera(700);
      const res = await enviarDiscord(op.fetch, await urlDe(w.id), cuerpo, espera, archivos);
      if (res.ok) ok++; else errores.push(`${w.nombre}: ${res.error}`);
    }
    const estado = ok === destinos.length ? "enviado" : ok ? "parcial" : "error";
    const faltan = pedidas.length - paginas.length;
    await actualizar(id, estado, ok, [errores.join(" · "), faltan ? `${faltan} página(s) sin imagen` : ""].filter(Boolean).join(" · ") || null);
    return { estado: estado === "enviado" ? "ok" : estado, id, enviados: ok, errores: errores.length };
  } catch (e) {
    const mensaje = String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
    if (id != null) await actualizar(id, "error", 0, mensaje).catch(() => {});
    else if (modo !== "generar") {
      await guardar({ market_key: cfg.market_key, fecha: diaLocal(ahora().getTime(), cfg.zona), desde: ahora().toISOString(),
                      hasta: ahora().toISOString(), tipo, estado: "error", datos: null, error: mensaje }).catch(() => {});
    }
    return { estado: "error", error: mensaje };
  } finally {
    await db.consulta("select informe_soltar_turno()", []);
  }
}
