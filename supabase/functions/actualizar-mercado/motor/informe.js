// Informe diario del mercado (MercadoWoW · Market Intelligence). Sin DOM ni red: el MISMO código analiza los
// datos y dibuja el informe en SVG para la vista previa de la página y para el PNG que llega a Discord (la Edge
// Function lo convierte con resvg).
//
// Integridad: todo sale de informe_base (SQL) y de los cálculos de fabricación de MercadoWoW. Lo que falta se
// dice («Sin datos», «Datos insuficientes»); nada se inventa ni se rellena. Precios por UNIDAD, en cobre.
// Ventas y oro movido: estimación de ventas/día del proveedor (un escaneo no distingue venta de cancelación).
// Criterios para descartar comparaciones poco fiables: ver `fiable` y `docs/INFORME_DIARIO.md`.

import { comisionVenta, depositoSubasta, REGLA_POR_DEFECTO } from "./fabricacion.js";
import { ICONO_RESPALDO, nombreProfesion } from "./sniper.js";
import { anchoTexto, barra, esc, linea, moneda, partesMoneda, recortar, rect, texto, textoMoneda } from "./tarjeta.js";

export const VERSION_INFORME = 1;
export const ANCHO_INFORME = 1600;
export const ARCHIVO_INFORME = "mercadowow-report.png";
export const FUENTE_TITULO = "Cinzel";
export const COLOR_EMBED = 0xE9BC65;

export const SECCIONES = Object.freeze([
  ["kpi", "Indicadores principales"], ["grafico", "Actividad de 24 h"], ["volumen", "Mayor volumen de oro"],
  ["comerciados", "Más comercializados"], ["subidas", "Mayores subidas"], ["caidas", "Mayores caídas"],
  ["arbitraje", "Arbitraje entre facciones"], ["gangas", "Gangas del día"], ["crafteos", "Mejores crafteos"],
  ["categorias", "Comportamiento por categorías"], ["destacados", "Datos interesantes"],
]);
export const CATEGORIAS = Object.freeze([
  ["general", "Mercado general"], ["mascotas", "Mascotas y monturas"], ["recetas", "Recetas"],
  ["encantamiento", "Mat. de encantamiento"], ["consumibles", "Consumibles"], ["hierbas", "Hierbas"],
  ["minerales", "Minerales"], ["barras", "Barras"], ["telas", "Telas"], ["cueros", "Cueros"], ["equipo", "Equipamiento"],
]);
export const CONFIG_INFORME = Object.freeze({
  gangas_desc_min: 30, craft_roi_min: 20, neta_min: 10000, liquidez_min: 0.5, por_seccion: 5,
  comision_pct: 5, recorte_pct: 5, comision_neutral_pct: 15, secciones: {},
});
/** Comisión de la casa neutral (para pasar objetos de una facción a otra). Valor por defecto, sin verificar. */
const FACCIONES = { horde: "Horda", alliance: "Alianza", neutral: "Neutral" };
const REGLAS = { pvp: "PvP", pve: "PvE", normal: "Normal (PvE)", hardcore: "Hardcore" };

// Columnas de cada objeto en informe_base.objetos.
const [ID, MED, MEDA, N, NA, Q, QA, ULT, QULT, SPD, SPDA, H30, NPC, CAT] = [...Array(14).keys()];
void QULT;

// ---------- utilidades ----------
const num = (v) => (v == null || v === "" ? null : Number(v));
const pctCambio = (a, b) => (a > 0 && b > 0 ? (a / b - 1) * 100 : null);
const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function mediana(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const formatoPct = (v, dec = 1) => (v == null ? "Sin datos"
  : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("es", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : dec })} %`);
export function formatoNumero(v) {
  if (v == null || !Number.isFinite(v)) return "Sin datos";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString("es", { maximumFractionDigits: 2 })} M`;
  return Math.round(v).toLocaleString("es", { useGrouping: "always" });
}
const formatoVeces = (v) => `${v.toLocaleString("es", { maximumFractionDigits: v >= 10 ? 0 : 1 })}×`;
/** Oro redondeado («23.293g»), para cifras grandes de oro. */
const oroRedondo = (cobre) => (cobre == null ? "Sin datos" : `${Math.round(cobre / 10000).toLocaleString("es", { useGrouping: "always" })}g`);
const fmt = (opciones, zona) => {
  try { return new Intl.DateTimeFormat("es", { ...opciones, timeZone: zona || "UTC" }); }
  catch { return new Intl.DateTimeFormat("es", { ...opciones, timeZone: "UTC" }); }
};
export const horaLocal = (ms, zona) => fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, zona).format(new Date(ms));
export const fechaLocal = (ms, zona) => fmt({ day: "numeric", month: "long", year: "numeric" }, zona).format(new Date(ms));
const fechaCorta = (ms, zona) => fmt({ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, zona).format(new Date(ms));
/** Fecha (AAAA-MM-DD) en una zona horaria. */
export function diaLocal(ms, zona) {
  const p = Object.fromEntries(fmt({ year: "numeric", month: "2-digit", day: "2-digit" }, zona).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function normalizarConfigInforme(c = {}) {
  const r = { ...CONFIG_INFORME };
  for (const k of Object.keys(CONFIG_INFORME)) if (c?.[k] != null) r[k] = k === "secciones" ? { ...c[k] } : Number(c[k]);
  r.por_seccion = Math.min(5, Math.max(3, Math.round(r.por_seccion) || 5));
  return r;
}
export const seccionVisible = (cfg, k) => cfg?.secciones?.[k] !== false;

/**
 * Comparación fiable de un objeto entre las dos ventanas de 24 h: bastantes escaneos en ambas, algo publicado
 * (no un único anuncio), un precio de al menos 1 plata y algo de actividad (si el proveedor la estima).
 */
function fiable(o, minEscaneos, liquidez = 0.1) {
  return o[N] >= minEscaneos && o[NA] >= minEscaneos && o[Q] >= 3 && o[QA] >= 3 && o[MEDA] >= 100 && o[MED] > 0
    && (o[SPD] == null || o[SPD] >= liquidez);
}
/** Precio por unidad para estimar el oro movido: la mediana de 24 h, sin pasar de la mediana de 30 días (un
 *  anuncio inflado no mueve oro). */
const precioVolumen = (o) => (o[H30] > 0 ? Math.min(o[MED], o[H30]) : o[MED]);
/** Variaciones de más de 20 veces se tratan como anomalías (anuncios sueltos o precios manipulados). */
const MAX_VECES = 20;

/** Objetos que podrían ser gangas (para pedir su mediana de 7 días): compra mínima muy por debajo de su mediana de 30 días. */
export function candidatosGanga(base, config = {}) {
  const c = normalizarConfigInforme(config);
  return base.objetos
    .filter((o) => o[ULT] > 0 && o[H30] > 0 && o[ULT] <= (1 - c.gangas_desc_min / 100) * o[H30] && o[SPD] != null && o[SPD] >= c.liquidez_min)
    .sort((a, b) => a[ULT] / a[H30] - b[ULT] / b[H30]).slice(0, 500).map((o) => o[ID]);
}

/** Mercados de la otra facción con los que comparar (mismo juego, región y reglas). */
export const mercadoOpuesto = (m, mercados) => mercados.find((x) => x.key !== m.key && x.juego === m.juego && x.region === m.region
  && x.reglas === m.reglas && x.faccion && m.faccion && x.faccion !== m.faccion && x.proveedor === m.proveedor) ?? null;

/**
 * Analiza los datos (informe_base) y devuelve el informe, aún sin nombres de objetos (ver completarInforme).
 * @param base     informe_base(mercado, hasta)
 * @param opciones config (informe_config), ref7 ({id: mediana 7 días}), crafteos (oportunidades de evaluar(),
 *                 ya filtradas), otro (informe_base de la otra facción o null), zona, ahora
 */
export function analizarInforme(base, { config = {}, ref7 = {}, crafteos = [], otro = null, zona = "UTC", ahora = Date.now() } = {}) {
  const c = normalizarConfigInforme(config);
  const n = c.por_seccion;
  const regla = { ...REGLA_POR_DEFECTO, comision_pct: c.comision_pct };
  const hasta = Date.parse(base.hasta), corte = hasta - 24 * 3600e3;
  const validas = base.serie.filter((s) => s[3]);
  const act = validas.filter((s) => s[0] > corte), ant = validas.filter((s) => s[0] <= corte);
  const objs = base.objetos;
  const minEscaneos = Math.max(2, Math.min(6, Math.ceil(act.length / 2), Math.ceil(ant.length / 2)));

  // ---- indicadores
  const conQ = act.filter((s) => Number.isFinite(s[1]));
  let pico = null, valle = null;
  for (const s of conQ) { if (!pico || s[1] > pico[1]) pico = s; if (!valle || s[1] < valle[1]) valle = s; }
  const ultimo = conQ.at(-1) ?? null;
  const mAct = media(conQ.map((s) => s[1])), mAnt = media(ant.filter((s) => Number.isFinite(s[1])).map((s) => s[1]));
  let oro = 0, oroAnt = 0, vend = 0, vendAnt = 0, conVentas = 0, conVentasAnt = 0;
  for (const o of objs) {
    if (o[SPD] != null && o[MED] > 0) { oro += o[SPD] * precioVolumen(o); vend += o[SPD]; conVentas++; }
    if (o[SPDA] != null && o[MEDA] > 0) { oroAnt += o[SPDA] * (o[H30] > 0 ? Math.min(o[MEDA], o[H30]) : o[MEDA]); vendAnt += o[SPDA]; conVentasAnt++; }
  }
  const kpi = {
    unidades: conQ.length ? { pico: pico[1], picoMs: pico[0], valle: valle[1], valleMs: valle[0], ultimo: ultimo[1], ultimoMs: ultimo[0],
                              media: Math.round(mAct), mediaAnt: mAnt == null ? null : Math.round(mAnt), variacion: pctCambio(mAct, mAnt) } : null,
    oro: conVentas ? { total: Math.round(oro), objetos: conVentas, variacion: conVentasAnt ? pctCambio(oro, oroAnt) : null } : null,
    vendidas: conVentas ? { total: Math.round(vend), variacion: conVentasAnt ? pctCambio(vend, vendAnt) : null } : null,
    escaneos: act.length, escaneosAnt: ant.length, descartados: base.serie.filter((s) => !s[3]).length, objetos: objs.length,
  };

  // ---- volumen de oro y más comercializados (estimaciones)
  // Solo objetos que se venden de verdad (liquidez mínima) y con algo publicado.
  const conV = objs.filter((o) => o[SPD] >= Math.max(c.liquidez_min, 0.5) && o[MED] > 0 && o[Q] >= 1);
  const volumen = [...conV].sort((a, b) => b[SPD] * precioVolumen(b) - a[SPD] * precioVolumen(a)).slice(0, n)
    .map((o) => ({ id: o[ID], oro: Math.round(o[SPD] * precioVolumen(o)), unidades: o[SPD], precio: precioVolumen(o) }));
  const comerciados = [...conV].sort((a, b) => b[SPD] - a[SPD] || b[MED] - a[MED]).slice(0, n)
    .map((o) => ({ id: o[ID], unidades: o[SPD], precio: o[MED], variacion: fiable(o, minEscaneos) ? pctCambio(o[MED], o[MEDA]) : null }));

  // ---- subidas y caídas (solo comparaciones fiables y de al menos un 5 %)
  const cambios = objs.filter((o) => fiable(o, minEscaneos, c.liquidez_min)).map((o) => ({ o, pct: pctCambio(o[MED], o[MEDA]) }))
    .filter((x) => x.pct <= (MAX_VECES - 1) * 100 && x.pct >= -(1 - 1 / MAX_VECES) * 100);
  const subidas = cambios.filter((x) => x.pct >= 5).sort((a, b) => b.pct - a.pct).slice(0, n)
    .map(({ o, pct }) => ({ id: o[ID], antes: o[MEDA], ahora: o[MED], pct, veces: o[MED] / o[MEDA] }));
  const caidas = cambios.filter((x) => x.pct <= -5).sort((a, b) => a.pct - b.pct).slice(0, n)
    .map(({ o, pct }) => ({ id: o[ID], antes: o[MEDA], ahora: o[MED], pct,
      // Posible compra: se vende a diario y ahora está claramente por debajo de su mediana de 30 días.
      compra: o[SPD] != null && o[SPD] >= 1 && o[H30] > 0 && o[ULT] > 0 && o[ULT] <= 0.8 * o[H30] }));

  // ---- gangas: compra mínima actual muy por debajo de su referencia (la menor de las medianas de 7 y 30 días)
  const gangas = [];
  for (const o of objs) {
    const r7 = num(ref7[o[ID]]);
    if (!(o[ULT] > 0 && o[H30] > 0 && r7 > 0 && o[SPD] != null && o[SPD] >= c.liquidez_min)) continue;
    const ref = Math.min(o[H30], r7);
    const descuento = (1 - o[ULT] / ref) * 100;
    if (descuento < c.gangas_desc_min) continue;
    if (!(o[MED] >= 0.6 * ref)) continue;            // todo el mercado del objeto cayó: no es una ganga puntual
    const reventa = Math.floor(ref * (1 - c.recorte_pct / 100));
    const comision = comisionVenta(reventa, regla), deposito = depositoSubasta(o[NPC], 1, regla);
    const neta = reventa - comision - deposito - o[ULT];
    if (neta < c.neta_min) continue;
    const coherente = Math.abs(o[H30] / r7 - 1) <= 0.3;
    const confianza = o[SPD] >= 2 && o[N] >= 12 && coherente && o[MED] >= 0.85 * ref ? "alta" : "media";
    gangas.push({ id: o[ID], compra: o[ULT], referencia: ref, ref7: r7, ref30: o[H30], reventa, comision: comision + deposito,
                  descuento, neta, roi: (neta / o[ULT]) * 100, liquidez: o[SPD], confianza });
  }
  gangas.sort((a, b) => (a.confianza === b.confianza ? 0 : a.confianza === "alta" ? -1 : 1) || b.neta - a.neta);

  // ---- crafteos (ya evaluados con el motor de fabricación de MercadoWoW)
  const crafts = crafteos.filter((o) => o.roi >= c.craft_roi_min && o.neta >= c.neta_min)
    .sort((a, b) => b.score - a.score || b.neta - a.neta).map((o) => ({
      spell: o.spell, id: o.id, nombre: o.nombre, icono: o.icono, calidad: o.calidad, profesion: o.profesion, unidades: o.unidades,
      coste: o.coste, venta: o.precioVenta, recomendado: o.conservador?.precio ?? null, comision: (o.comision ?? 0) + (o.deposito ?? 0),
      neta: o.neta, roi: o.roi, demanda: o.ventas ?? null, score: o.score, riesgo: o.riesgo,
    }));

  // ---- categorías: mediana de la variación de cada objeto con datos en ambas ventanas
  const grupos = new Map(CATEGORIAS.map(([k]) => [k, []]));
  for (const o of objs) {
    if (!(o[N] >= Math.min(3, minEscaneos) && o[NA] >= Math.min(3, minEscaneos) && o[MED] > 0 && o[MEDA] > 0)) continue;
    const p = pctCambio(o[MED], o[MEDA]);
    grupos.get("general").push(p);
    if (o[CAT] && grupos.has(o[CAT])) grupos.get(o[CAT]).push(p);
  }
  const categorias = CATEGORIAS.map(([clave, nombre]) => {
    const xs = grupos.get(clave);
    const variacion = xs.length >= 3 ? mediana(xs) : null;
    return { clave, nombre, variacion, suben: xs.filter((p) => p > 2).length, bajan: xs.filter((p) => p < -2).length, total: xs.length,
             tendencia: variacion == null ? null : variacion > 2 ? "sube" : variacion < -2 ? "baja" : "estable" };
  });

  // ---- arbitraje entre facciones (solo si se registra la otra facción con precios recientes)
  let arbitraje;
  const facA = FACCIONES[base.mercado.faccion] ?? base.mercado.faccion ?? "esta facción";
  if (!otro) {
    arbitraje = { disponible: false, motivo: `Solo se registran precios de la casa de ${facA}: no hay datos de la otra facción para comparar.` };
  } else {
    const facB = FACCIONES[otro.mercado.faccion] ?? otro.mercado.faccion;
    const delOtro = new Map(otro.objetos.map((o) => [o[ID], o]));
    const filas = [];
    for (const a of objs) {
      const b = delOtro.get(a[ID]);
      if (!b || !(a[ULT] > 0 && b[ULT] > 0 && a[MED] > 0 && b[MED] > 0)) continue;
      if (Math.max(a[SPD] ?? 0, b[SPD] ?? 0) < c.liquidez_min) continue;
      // Precio típico de cada lado (mediana de 24 h): una sola oferta suelta no hace un arbitraje.
      const [barato, caro, facBarata] = a[MED] <= b[MED] ? [a[MED], b[MED], facA] : [b[MED], a[MED], facB];
      const veces = caro / barato;
      if (veces < 1.5) continue;
      const potencial = Math.floor(caro * (1 - c.comision_neutral_pct / 100)) - barato;
      if (potencial < c.neta_min) continue;
      filas.push({ id: a[ID], precioA: a[MED], precioB: b[MED], veces, diferencia: (caro / barato - 1) * 100, barata: facBarata, potencial });
    }
    filas.sort((x, y) => y.veces - x.veces);
    arbitraje = { disponible: true, facA, facB, filas: filas.slice(0, n), total: filas.length };
  }

  return {
    version: VERSION_INFORME, mercado: base.mercado, zona, generado: ahora, desde: corte, hasta,
    fecha: diaLocal(hasta, zona), config: c,
    serie: act.map((s) => [s[0], s[1]]),
    kpi, volumen, comerciados, subidas, caidas,
    gangas: gangas.slice(0, n), gangasTotal: gangas.length,
    crafteos: crafts.slice(0, n), crafteosTotal: crafts.length,
    categorias, arbitraje, objetos: {}, destacados: [], resumen: "",
  };
}

/** IDs de objetos que aparecen en el informe (para pedir nombre, icono y calidad). */
export function idsInforme(inf) {
  const ids = new Set();
  for (const k of ["volumen", "comerciados", "subidas", "caidas", "gangas"]) for (const x of inf[k]) ids.add(x.id);
  for (const x of inf.arbitraje?.filas ?? []) ids.add(x.id);
  return [...ids];
}

const nombreDe = (inf, id) => inf.objetos?.[id]?.n ?? `Objeto ${id}`;
const nombreCat = (k) => CATEGORIAS.find(([c]) => c === k)?.[1] ?? k;

/** Añade nombres e iconos ({id: {n, i, q}}), los datos destacados y el resumen (todo a partir de los datos). */
export function completarInforme(inf, objetos = {}) {
  inf.objetos = objetos;
  const zona = inf.zona;
  // ---- datos interesantes: los primeros 4 que existan (nada de textos fijos)
  const d = [];
  const sub = inf.subidas[0];
  if (sub) d.push({ id: sub.id, cifra: sub.veces >= 2 ? formatoVeces(sub.veces) : formatoPct(sub.pct), color: "verde",
    texto: `${nombreDe(inf, sub.id)}: de ${textoMoneda(sub.antes)} a ${textoMoneda(sub.ahora)} (mediana de 24 h).` });
  const g = inf.gangas[0];
  if (g) d.push({ id: g.id, cifra: `−${Math.round(g.descuento)} %`, color: "verde",
    texto: `${nombreDe(inf, g.id)} a ${textoMoneda(g.compra)}; su referencia es ${textoMoneda(g.referencia)}.` });
  const cats = inf.categorias.filter((x) => x.clave !== "general" && x.total >= 5 && x.variacion != null);
  const masMovida = [...cats].sort((a, b) => Math.max(b.bajan, b.suben) / b.total - Math.max(a.bajan, a.suben) / a.total)[0];
  if (masMovida) {
    const bajan = masMovida.bajan >= masMovida.suben;
    d.push({ cifra: `${bajan ? masMovida.bajan : masMovida.suben} de ${masMovida.total}`, color: bajan ? "rojo" : "verde",
      texto: `${masMovida.nombre}: ${bajan ? "bajaron" : "subieron"} de precio; la mediana, ${formatoPct(masMovida.variacion)}.` });
  }
  const u = inf.kpi.unidades;
  if (u) d.push({ cifra: formatoNumero(u.pico), color: "texto",
    texto: `unidades publicadas a las ${horaLocal(u.picoMs, zona)}, el máximo del día; el mínimo, ${formatoNumero(u.valle)} a las ${horaLocal(u.valleMs, zona)}.` });
  const v = inf.volumen[0];
  if (v) d.push({ id: v.id, cifra: oroRedondo(v.oro), color: "oro", texto: `${nombreDe(inf, v.id)}: el objeto que más oro movió al día (estimación).` });
  const cr = inf.crafteos[0];
  if (cr) d.push({ id: cr.id, cifra: `+${textoMoneda(cr.neta)}`, color: "verde",
    texto: `${cr.nombre}: el crafteo más rentable (${formatoPct(cr.roi, 0).replace("+", "")} de ROI).` });
  inf.destacados = d.slice(0, 4);

  // ---- resumen
  const frases = [];
  if (u?.variacion != null) {
    frases.push(Math.abs(u.variacion) < 1 ? "Las unidades publicadas se mantuvieron estables frente a las 24 h anteriores."
      : `Las unidades publicadas ${u.variacion > 0 ? "subieron" : "bajaron"} un ${formatoPct(Math.abs(u.variacion)).replace("+", "")} frente a las 24 h anteriores.`);
  }
  const conVar = cats.filter((x) => x.total >= 3);
  const alza = [...conVar].sort((a, b) => b.variacion - a.variacion)[0], baja = [...conVar].sort((a, b) => a.variacion - b.variacion)[0];
  const partes = [];
  if (alza && alza.variacion > 2) partes.push(`${alza.nombre.toLowerCase()} subieron un ${formatoPct(alza.variacion).replace("+", "")}`);
  if (baja && baja.variacion < -2) partes.push(`${baja.nombre.toLowerCase()} bajaron un ${formatoPct(-baja.variacion).replace("+", "")}`);
  if (partes.length) { const t = partes.join(" y "); frases.push(`Por categorías, ${t} (mediana).`); }
  const gen = inf.categorias.find((x) => x.clave === "general");
  if (gen?.total) frases.push(`${gen.bajan.toLocaleString("es")} objetos bajaron de precio y ${gen.suben.toLocaleString("es")} subieron.`);
  frases.push(`Se detectaron ${inf.gangasTotal} ${inf.gangasTotal === 1 ? "ganga" : "gangas"} de reventa y ${inf.crafteosTotal} ${inf.crafteosTotal === 1 ? "crafteo rentable" : "crafteos rentables"}.`);
  inf.resumen = frases.join(" ");
  return inf;
}

// ---------- mensaje de Discord ----------
export function mensajeInforme(inf, { sitio = "", nombre = "MercadoWoW | Market Intelligence", avatar = null, manual = false } = {}) {
  const m = inf.mercado;
  const lugar = [`WoW Forever`, (m.region ?? "").toUpperCase(), REGLAS[m.reglas] ?? m.reglas, FACCIONES[m.faccion] ?? m.faccion].filter(Boolean).join(" · ");
  const periodo = `${fechaCorta(inf.desde, inf.zona)} – ${fechaCorta(inf.hasta, inf.zona)} (${inf.zona})`;
  const desc = [`**${lugar}** · ${fechaLocal(inf.hasta, inf.zona)}`, `Período: ${periodo}`, "", inf.resumen,
    sitio ? `\n[Abrir el panel de MercadoWoW](${sitio})` : ""].join("\n").slice(0, 4000);
  return {
    username: nombre, ...(avatar ? { avatar_url: avatar } : {}), allowed_mentions: { parse: [] },
    attachments: [{ id: 0, filename: ARCHIVO_INFORME, description: `Informe diario del mercado · ${inf.fecha}` }],
    embeds: [{
      title: "Informe diario del mercado", ...(sitio ? { url: sitio } : {}), description: desc, color: COLOR_EMBED,
      image: { url: `attachment://${ARCHIVO_INFORME}` },
      footer: { text: `MercadoWoW · Market Intelligence${manual ? " · Envío manual" : ""} · ${m.atribucion || (m.proveedor === "tsm" ? "Precios: TradeSkillMaster" : m.proveedor)}` },
      timestamp: new Date(inf.generado).toISOString(),
    }],
  };
}

export function mensajePruebaInforme({ sitio = "", nombre = "MercadoWoW | Market Intelligence", avatar = null, ahora = Date.now() } = {}) {
  return {
    username: nombre, ...(avatar ? { avatar_url: avatar } : {}), allowed_mentions: { parse: [] },
    embeds: [{ title: "Prueba del informe diario", ...(sitio ? { url: sitio } : {}), color: COLOR_EMBED,
      description: "La conexión funciona: aquí llegará el informe diario del mercado de MercadoWoW.",
      footer: { text: "MercadoWoW · Market Intelligence" }, timestamp: new Date(ahora).toISOString() }],
  };
}

// ---------- dibujo (SVG) ----------
const T = {
  fondo: "#0E0E10", tarjeta: "#19191D", borde: "#2B2B30", oro: "#E9BC65", texto: "#F5EBD5", sec: "#A8A196",
  verde: "#8BCB70", rojo: "#E36B65", azul: "#65C4D9", plata: "#CBD5E1", cobre: "#E0965A", pista: "#26262B",
};
const W = ANCHO_INFORME, M = 64, CW = W - 2 * M, GAP = 48, COL = (CW - GAP) / 2;
const titulo = (t) => ({ tam: 26, peso: 700, color: T.oro, esp: 2.5, fuente: FUENTE_TITULO, t: t.toUpperCase() });

/** Parte un texto en líneas que quepan en `ancho`. */
export function envolver(t, tam, peso, ancho) {
  const lineas = [];
  let l = "";
  for (const p of String(t).split(/\s+/)) {
    const prueba = l ? `${l} ${p}` : p;
    if (anchoTexto(prueba, tam, peso) <= ancho || !l) l = prueba; else { lineas.push(l); l = p; }
  }
  if (l) lineas.push(l);
  return lineas;
}
const triangulo = (x, y, sube, color, s = 14) => sube
  ? `<polygon points="${x},${y} ${x + s / 2},${y - s} ${x + s},${y}" fill="${color}"/>`
  : `<polygon points="${x},${y - s} ${x + s},${y - s} ${x + s / 2},${y}" fill="${color}"/>`;

/**
 * Dibuja el informe. `iconos`: {url: href} (en el servidor, los iconos incrustados en base64).
 * @returns {{svg: string, ancho: number, alto: number}}
 */
export function informeSVG(inf, { iconos = {}, sitio = "" } = {}) {
  const c = inf.config ?? CONFIG_INFORME;
  const ver = (k) => seccionVisible(c, k);
  const P = [], defs = [];
  let nIco = 0;
  const href = (u) => esc(iconos[u ?? ICONO_RESPALDO] ?? u ?? ICONO_RESPALDO);
  const iconoObj = (id, x, y, s) => {
    const o = inf.objetos?.[id] ?? {};
    const k = `ic${nIco++}`;
    defs.push(`<clipPath id="${k}"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${Math.round(s / 6)}"/></clipPath>`);
    return rect(x - 1, y - 1, s + 2, s + 2, { rx: Math.round(s / 6) + 1, fill: T.tarjeta, stroke: T.borde })
      + `<image href="${href(o.i ?? (typeof id === "string" ? id : null))}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${k})"/>`;
  };
  const iconoUrl = (url, x, y, s) => {
    const k = `ic${nIco++}`;
    defs.push(`<clipPath id="${k}"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${Math.round(s / 6)}"/></clipPath>`);
    return `<image href="${href(url)}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${k})"/>`;
  };
  const tituloSec = (x, y, t, sub = null) => {
    const o = titulo(t);
    P.push(texto(x, y, o.t, o));
    if (sub) P.push(texto(x, y + 30, sub, { tam: 18, color: T.sec }));
    return sub ? 50 : 22;
  };
  const sinDatos = (x, y, w, t) => { P.push(rect(x, y, w, 70, { rx: 12, fill: T.tarjeta, stroke: T.borde }), texto(x + 24, y + 44, t, { tam: 21, color: T.sec })); return 70; };
  const nom = (id) => nombreDe(inf, id);
  const m = inf.mercado, zona = inf.zona;
  let y = 0;

  // ---- cabecera
  P.push(`<g fill="${T.oro}">${[[0, 14, 16], [12, 6, 24], [24, 0, 30]].map(([dx, dy, h]) => `<rect x="${M + dx}" y="${46 + dy}" width="8" height="${h}" rx="2"/>`).join("")}</g>`,
    texto(M + 48, 76, "MERCADOWOW", { tam: 32, peso: 700, color: T.oro, esp: 4, fuente: FUENTE_TITULO }));
  const lugar = [`WoW Forever`, (m.region ?? "").toUpperCase(), REGLAS[m.reglas] ?? m.reglas, FACCIONES[m.faccion] ?? m.faccion].filter(Boolean).join(" · ");
  P.push(texto(W - M, 62, lugar, { tam: 22, color: T.sec, ancla: "end" }), texto(W - M, 92, fechaLocal(inf.hasta, zona), { tam: 22, color: T.sec, ancla: "end" }));
  P.push(texto(M, 186, "Informe diario del mercado", { tam: 76, peso: 700, color: T.oro, fuente: FUENTE_TITULO }));
  P.push(texto(M, 232, `Últimas 24 h: ${fechaCorta(inf.desde, zona)} – ${fechaCorta(inf.hasta, zona)} (${zona}) · actualizado a las ${horaLocal(inf.generado, zona)}`,
    { tam: 22, color: T.sec }));
  y = 290;
  for (const l of envolver(inf.resumen, 30, 400, CW)) { P.push(texto(M, y, l, { tam: 30, color: T.texto })); y += 44; }
  y += 18;

  // ---- KPI
  if (ver("kpi")) {
    const k = inf.kpi, wk = (CW - 3 * 24) / 4, hk = 190;
    const vari = (v, sufijo) => (v == null ? null : { t: `${formatoPct(v)} ${sufijo}`, color: v > 0 ? T.verde : v < 0 ? T.rojo : T.sec, sube: v > 0 });
    const tarjetas = [
      { cifra: k.unidades ? formatoNumero(k.unidades.pico) : null, texto: k.unidades ? `unidades publicadas en el máximo del día, a las ${horaLocal(k.unidades.picoMs, zona)}` : "unidades publicadas", v: null },
      { cifra: k.unidades?.variacion != null ? formatoPct(k.unidades.variacion) : null, color: k.unidades?.variacion > 0 ? T.verde : k.unidades?.variacion < 0 ? T.rojo : T.texto,
        texto: "unidades publicadas (media) frente a las 24 h anteriores", v: null },
      { cifra: k.oro ? oroRedondo(k.oro.total) : null, texto: k.oro ? `movido al día en ${k.oro.objetos.toLocaleString("es", { useGrouping: "always" })} objetos (estimación)` : "oro movido al día", v: vari(k.oro?.variacion, "vs. ayer") },
      { cifra: k.vendidas ? formatoNumero(k.vendidas.total) : null, texto: "unidades vendidas al día (estimación del proveedor)", v: vari(k.vendidas?.variacion, "vs. ayer") },
    ];
    tarjetas.forEach((t, i) => {
      const x = M + i * (wk + 24);
      P.push(rect(x, y, wk, hk, { rx: 14, fill: T.tarjeta, stroke: T.borde }));
      P.push(t.cifra == null ? texto(x + 24, y + 72, "Sin datos", { tam: 40, peso: 700, color: T.sec })
        : texto(x + 24, y + 74, t.cifra, { tam: Math.min(56, Math.floor(56 * (wk - 48) / Math.max(1, anchoTexto(t.cifra, 56, 800)))), peso: 800, color: t.color ?? T.texto }));
      envolver(t.texto, 20, 400, wk - 48).slice(0, 2).forEach((l, j) => P.push(texto(x + 24, y + 112 + j * 26, l, { tam: 20, color: T.sec })));
      if (t.v) P.push(triangulo(x + 24, y + 170, t.v.sube, t.v.color, 12), texto(x + 44, y + 170, t.v.t, { tam: 19, peso: 600, color: t.v.color }));
    });
    y += hk + 44;
  }

  // ---- gráfico de actividad
  if (ver("grafico")) {
    y += tituloSec(M, y + 8, "Actividad del mercado · 24 h", "Unidades publicadas en cada escaneo válido (no se rellenan las horas sin escaneo)") + 20;
    const s = inf.serie.filter((p) => Number.isFinite(p[1]));
    const hG = 320;
    if (s.length < 3) {
      y += sinDatos(M, y, CW, "Datos insuficientes: hacen falta al menos 3 escaneos válidos en las últimas 24 h.") + 36;
    } else {
      const gx = M + 84, gw = W - M - gx, gy = y + 30, gh = hG - 70;
      const vals = s.map((p) => p[1]);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      const margen = (hi - lo) * 0.15 || hi * 0.05 || 1;
      lo = Math.max(0, lo - margen); hi += margen;
      const t0 = inf.desde, t1 = inf.hasta;
      const px = (t) => gx + ((t - t0) / (t1 - t0)) * gw, py = (v) => gy + gh - ((v - lo) / (hi - lo)) * gh;
      for (let i = 0; i <= 3; i++) {
        const v = lo + ((hi - lo) * i) / 3, yy = py(v);
        P.push(linea(gx, yy, gx + gw, yy, T.borde), texto(gx - 12, yy + 6, formatoNumero(v), { tam: 17, color: T.sec, ancla: "end" }));
      }
      // Marcas del eje X cada 3 horas locales.
      const paso = 3600e3;
      for (let t = Math.ceil(t0 / paso) * paso; t <= t1; t += paso) {
        const h = Number(horaLocal(t, zona).slice(0, 2));
        if (h % 3) continue;
        P.push(linea(px(t), gy + gh, px(t), gy + gh + 8, T.borde), texto(px(t), gy + gh + 32, horaLocal(t, zona), { tam: 17, color: T.sec, ancla: "middle" }));
      }
      const pts = s.map((p) => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(" ");
      defs.push(`<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.oro}" stop-opacity=".22"/><stop offset="1" stop-color="${T.oro}" stop-opacity="0"/></linearGradient>`);
      P.push(`<polygon points="${px(s[0][0]).toFixed(1)},${gy + gh} ${pts} ${px(s.at(-1)[0]).toFixed(1)},${gy + gh}" fill="url(#area)"/>`,
        `<polyline points="${pts}" fill="none" stroke="${T.oro}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`,
        ...s.map((p) => `<circle cx="${px(p[0]).toFixed(1)}" cy="${py(p[1]).toFixed(1)}" r="3.5" fill="${T.oro}"/>`));
      const u = inf.kpi.unidades;
      const marca = (ms, v, color, etiqueta, arriba) => {
        const x = px(ms), yy = py(v);
        const w = anchoTexto(etiqueta, 19, 600);
        const ancla = x - w / 2 < gx ? "start" : x + w / 2 > gx + gw ? "end" : "middle";
        P.push(`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="8" fill="${color}" stroke="${T.fondo}" stroke-width="3"/>`,
          texto(ancla === "start" ? x - 6 : ancla === "end" ? x + 6 : x, arriba ? yy - 18 : yy + 34, etiqueta, { tam: 19, peso: 600, color: T.texto, ancla }));
      };
      if (u) {
        marca(u.picoMs, u.pico, T.texto, `${formatoNumero(u.pico)} a las ${horaLocal(u.picoMs, zona)}, el máximo`, true);
        marca(u.valleMs, u.valle, T.rojo, `${formatoNumero(u.valle)} a las ${horaLocal(u.valleMs, zona)}, el mínimo`, false);
        if (u.ultimoMs !== u.picoMs && u.ultimoMs !== u.valleMs) marca(u.ultimoMs, u.ultimo, T.oro, `${formatoNumero(u.ultimo)} a las ${horaLocal(u.ultimoMs, zona)}`, py(u.ultimo) > gy + gh / 2);
      }
      y += hG + 30;
    }
  }

  // ---- dos columnas
  const filaDoble = (izq, der) => {
    const yi = y;
    const hs = [izq, der].filter(Boolean).map((f, i, arr) => f(arr.length === 1 ? M : M + i * (COL + GAP), yi, arr.length === 1 ? CW : COL));
    if (hs.length) y = yi + Math.max(...hs) + 40;
  };
  const listaBarras = (claves, { tit, sub, color, valor, extra, vacio }) => (x, y0, w) => {
    let yy = y0 + tituloSec(x, y0 + 8, tit, sub) + 22;
    const filas = claves;
    if (!filas.length) return yy - y0 + sinDatos(x, yy, w, vacio);
    const max = Math.max(...filas.map((f) => f.__v));
    filas.forEach((f) => {
      P.push(iconoObj(f.id, x, yy + 6, 40), texto(x + 56, yy + 34, recortar(nom(f.id), 23, 500, w * 0.42 - 56), { tam: 23, peso: 500, color: T.texto }));
      P.push(barra(x + w * 0.45, yy + 20, w * 0.25, 14, f.__v / max, color, T));
      P.push(valor(f, x + w, yy + 28), texto(x + w, yy + 52, recortar(extra(f), 16, 400, w * 0.3), { tam: 16, color: T.sec, ancla: "end" }));
      yy += 64;
    });
    return yy - y0;
  };
  const nVent = (v) => v.toLocaleString("es", { maximumFractionDigits: v < 10 ? 1 : 0, useGrouping: "always" });
  filaDoble(
    ver("volumen") && listaBarras(inf.volumen.map((f) => ({ ...f, __v: f.oro })), {
      tit: "Mayor volumen de oro · 24 h", sub: "Oro movido al día por objeto (estimación)", color: T.oro, vacio: "Sin estimaciones de ventas para este mercado.",
      valor: (f, x, yy) => moneda(x, yy, f.oro, { tam: 23, peso: 700, color: T.texto, ancla: "end", ap: {}, T }),
      extra: (f) => `≈ ${nVent(f.unidades)}/día · ${textoMoneda(f.precio)} c/u` }),
    ver("comerciados") && listaBarras(inf.comerciados.map((f) => ({ ...f, __v: f.unidades })), {
      tit: "Objetos más comercializados", sub: "Unidades vendidas al día (estimación)", color: T.azul, vacio: "Sin estimaciones de ventas para este mercado.",
      valor: (f, x, yy) => texto(x, yy, `≈ ${nVent(f.unidades)}`, { tam: 23, peso: 700, color: T.texto, ancla: "end" }),
      extra: (f) => `${textoMoneda(f.precio)} c/u${f.variacion != null ? ` · ${formatoPct(f.variacion, 0)}` : ""}` }),
  );

  const listaCambios = (filas, { tit, sub, sube, vacio }) => (x, y0, w) => {
    let yy = y0 + tituloSec(x, y0 + 8, tit, sub) + 22;
    if (!filas.length) return yy - y0 + sinDatos(x, yy, w, vacio);
    const color = sube ? T.verde : T.rojo;
    filas.forEach((f, i) => {
      if (i) P.push(linea(x, yy, x + w, yy, T.borde));
      P.push(iconoObj(f.id, x, yy + 14, 44), texto(x + 60, yy + 38, recortar(nom(f.id), 23, 500, w - 60 - 170), { tam: 23, peso: 500, color: T.texto }));
      const det = `${textoMoneda(f.antes)} → ${textoMoneda(f.ahora)}`;
      P.push(texto(x + 60, yy + 64, det, { tam: 18, color: T.sec }));
      if (f.compra) P.push(texto(x + 60 + anchoTexto(det, 18) + 16, yy + 64, "posible compra", { tam: 16, peso: 600, color: T.verde }));
      const t = formatoPct(f.pct, 0).replace("+", "");
      P.push(texto(x + w, yy + 52, t, { tam: 30, peso: 800, color, ancla: "end" }), triangulo(x + w - anchoTexto(t, 30, 800) - 30, yy + 48, sube, color, 16));
      yy += 82;
    });
    return yy - y0;
  };
  filaDoble(
    ver("subidas") && listaCambios(inf.subidas, { tit: "Mayores subidas · 24 h", sub: "Mediana de 24 h frente a las 24 h anteriores", sube: true, vacio: "Ninguna subida fiable de al menos un 5 %." }),
    ver("caidas") && listaCambios(inf.caidas, { tit: "Mayores caídas · 24 h", sub: "Mediana de 24 h frente a las 24 h anteriores", sube: false, vacio: "Ninguna caída fiable de al menos un 5 %." }),
  );

  // ---- gangas (ancho completo)
  if (ver("gangas")) {
    y += tituloSec(M, y + 8, "Gangas del día", `Compra mínima actual frente a la menor de sus medianas de 7 y 30 días · descuento ≥ ${c.gangas_desc_min} % · ≥ ${c.liquidez_min} ventas/día`) + 22;
    if (!inf.gangas.length) y += sinDatos(M, y, CW, "Ninguna ganga con los criterios actuales.") + 40;
    else {
      const cols = [["Compra", "compra"], ["Referencia", "referencia"], ["Reventa", "reventa"], ["Beneficio neto", "neta"]];
      const xc = (i) => M + 560 + i * 160;
      cols.forEach(([t], i) => P.push(texto(xc(i) + 150, y + 4, t, { tam: 16, peso: 600, color: T.sec, ancla: "end" })));
      P.push(texto(xc(4) + 110, y + 4, "ROI", { tam: 16, peso: 600, color: T.sec, ancla: "end" }));
      y += 16;
      inf.gangas.forEach((g) => {
        P.push(rect(M, y, CW, 92, { rx: 12, fill: T.tarjeta, stroke: T.borde }), iconoObj(g.id, M + 20, y + 20, 52));
        P.push(texto(M + 88, y + 44, recortar(nom(g.id), 25, 600, 440), { tam: 25, peso: 600, color: T.texto }),
          texto(M + 88, y + 72, recortar(`Confianza ${g.confianza} · ≈ ${nVent(g.liquidez)} ventas/día · comisión ${textoMoneda(g.comision)}`, 17, 400, 450), { tam: 17, color: T.sec }));
        cols.forEach(([, k], i) => P.push(moneda(xc(i) + 150, y + 56, g[k], { tam: 21, peso: 700, color: k === "neta" ? T.verde : T.texto, ancla: "end", ap: {}, T })));
        P.push(texto(xc(4) + 110, y + 56, formatoPct(g.roi, 0).replace("+", ""), { tam: 21, peso: 700, color: T.verde, ancla: "end" }));
        P.push(texto(W - M - 24, y + 60, `−${Math.round(g.descuento)} %`, { tam: 38, peso: 800, color: T.verde, ancla: "end" }));
        y += 104;
      });
      y += 30;
    }
  }

  // ---- crafteos
  if (ver("crafteos")) {
    y += tituloSec(M, y + 8, "Mejores crafteos del día", `Materiales a precio de subasta · ROI ≥ ${c.craft_roi_min} % · beneficio ≥ ${textoMoneda(c.neta_min)} · cálculo de fabricación de MercadoWoW`) + 22;
    if (!inf.crafteos.length) y += sinDatos(M, y, CW, "Ningún crafteo cumple los mínimos con los precios actuales.") + 40;
    else {
      const maxRoi = Math.max(...inf.crafteos.map((f) => f.roi));
      inf.crafteos.forEach((f) => {
        const h = 132;
        P.push(rect(M, y, CW, h, { rx: 12, fill: T.tarjeta, stroke: T.borde }), iconoUrl(f.icono, M + 20, y + 20, 52));
        P.push(texto(M + 88, y + 44, recortar(f.nombre, 25, 600, 480), { tam: 25, peso: 600, color: T.texto }),
          texto(M + 88, y + 72, `${nombreProfesion(f.profesion)}${f.unidades > 1 ? ` · ${f.unidades} por fabricación` : ""}`, { tam: 18, color: T.sec }));
        const cols = [["Coste", f.coste, T.texto], ["Venta", f.venta, T.texto], ["Precio rec.", f.recomendado, T.texto], ["Comisión", f.comision, T.texto], ["Beneficio neto", f.neta, T.verde]];
        cols.forEach(([t, v, col], i) => {
          const xr = M + 700 + i * 152;
          P.push(texto(xr, y + 34, t, { tam: 16, peso: 600, color: T.sec, ancla: "end" }), moneda(xr, y + 64, v, { tam: 21, peso: 700, color: col, ancla: "end", ap: {}, T }));
        });
        P.push(barra(M + 88, y + 96, CW - 88 - 220, 12, f.roi / Math.max(100, maxRoi), T.verde, T),
          texto(W - M - 24, y + 108, `${formatoPct(f.roi, 0).replace("+", "")} ROI`, { tam: 22, peso: 800, color: T.verde, ancla: "end" }),
          texto(M + 88, y + 124, f.demanda != null ? `Demanda ≈ ${nVent(f.demanda)} ventas/día` : "Demanda sin datos", { tam: 15, color: T.sec }));
        y += h + 12;
      });
      y += 30;
    }
  }

  // ---- arbitraje
  if (ver("arbitraje")) {
    const a = inf.arbitraje;
    y += tituloSec(M, y + 8, "Arbitraje entre facciones", "Precio típico (mediana de 24 h) del mismo objeto en cada facción") + 22;
    if (!a?.disponible) y += sinDatos(M, y, CW, a?.motivo ?? "Sin datos de la otra facción.") + 40;
    else if (!a.filas.length) y += sinDatos(M, y, CW, "Ninguna diferencia aprovechable con los criterios actuales.") + 40;
    else {
      a.filas.forEach((f, i) => {
        if (i) P.push(linea(M, y, W - M, y, T.borde));
        P.push(iconoObj(f.id, M, y + 14, 44), texto(M + 60, y + 38, recortar(nom(f.id), 23, 500, 700), { tam: 23, peso: 500, color: T.texto }),
          texto(M + 60, y + 64, `${a.facA} ${textoMoneda(f.precioA)} · ${a.facB} ${textoMoneda(f.precioB)} · más barato en ${f.barata} · potencial ≈ ${textoMoneda(f.potencial)} (con ${c.comision_neutral_pct} % de comisión)`, { tam: 18, color: T.sec }),
          texto(W - M, y + 52, formatoVeces(f.veces), { tam: 30, peso: 800, color: T.azul, ancla: "end" }));
        y += 82;
      });
      P.push(texto(M, y + 20, "Estimación: requiere poder mover el objeto entre facciones; no es un beneficio garantizado.", { tam: 16, color: T.sec }));
      y += 60;
    }
  }

  // ---- categorías
  if (ver("categorias")) {
    y += tituloSec(M, y + 8, "Comportamiento por categorías", "Mediana de la variación de precio de cada objeto frente a las 24 h anteriores") + 22;
    const porFila = 6, wc = (CW - (porFila - 1) * 16) / porFila, hc = 132;
    inf.categorias.forEach((k, i) => {
      const x = M + (i % porFila) * (wc + 16), yy = y + Math.floor(i / porFila) * (hc + 16);
      const color = k.tendencia === "sube" ? T.verde : k.tendencia === "baja" ? T.rojo : T.sec;
      P.push(rect(x, yy, wc, hc, { rx: 12, fill: T.tarjeta, stroke: T.borde }),
        texto(x + 18, yy + 34, recortar(k.nombre, 19, 600, wc - 36), { tam: 19, peso: 600, color: T.texto }));
      if (k.variacion == null) P.push(texto(x + 18, yy + 84, "Sin datos", { tam: 26, peso: 700, color: T.sec }));
      else {
        const t = formatoPct(k.variacion);
        P.push(texto(x + 18, yy + 86, t, { tam: 36, peso: 800, color }));
        P.push(texto(x + 18, yy + 116, `▼ ${k.bajan} · ▲ ${k.suben} de ${k.total}`, { tam: 16, color: T.sec }));
      }
    });
    y += Math.ceil(inf.categorias.length / porFila) * (hc + 16) + 30;
  }

  // ---- datos interesantes
  if (ver("destacados") && inf.destacados.length) {
    y += tituloSec(M, y + 8, "Datos interesantes del día") + 22;
    const nD = inf.destacados.length, wd = (CW - (nD - 1) * 24) / nD, hd = 176;
    const colores = { verde: T.verde, rojo: T.rojo, oro: T.oro, texto: T.texto };
    inf.destacados.forEach((d, i) => {
      const x = M + i * (wd + 24);
      P.push(rect(x, y, wd, hd, { rx: 14, fill: T.tarjeta, stroke: T.borde }));
      let xc = x + 22;
      if (d.id != null) { P.push(iconoObj(d.id, x + 22, y + 22, 44)); xc += 58; }
      P.push(texto(xc, y + 58, recortar(d.cifra, 36, 800, x + wd - 22 - xc), { tam: 36, peso: 800, color: colores[d.color] ?? T.texto }));
      envolver(d.texto, 19, 400, wd - 44).slice(0, 4).forEach((l, j) => P.push(texto(x + 22, y + 98 + j * 24, l, { tam: 19, color: T.sec })));
    });
    y += hd + 40;
  }

  // ---- pie
  P.push(linea(M, y, W - M, y, T.borde));
  const fuente = m.atribucion || (m.proveedor === "tsm" ? "Precios: TradeSkillMaster" : m.proveedor);
  const pie = `${inf.kpi.escaneos} escaneos válidos (${inf.kpi.descartados} incompletos descartados) entre ${fechaCorta(inf.desde, zona)} y ${fechaCorta(inf.hasta, zona)} (${zona}). `
    + "Ventas y oro movido: estimaciones (un escaneo no distingue una venta de una cancelación). "
    + `${fuente}. Iconos de objetos: Blizzard Entertainment. No afiliado con Blizzard.`;
  const dominio = String(sitio || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const lineasPie = envolver(pie, 17, 400, CW - (dominio ? 340 : 0));
  lineasPie.forEach((l, j) => P.push(texto(M, y + 36 + j * 24, l, { tam: 17, color: T.sec })));
  if (dominio) P.push(texto(W - M, y + 38, dominio, { tam: 22, peso: 700, color: T.oro, ancla: "end" }));
  y += 36 + lineasPie.length * 24 + 24;

  const alto = Math.ceil(y);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${alto}" width="${W}" height="${alto}">`
    + `<defs>${defs.join("")}</defs>${rect(0, 0, W, alto, { fill: T.fondo })}`
    + `${rect(0.5, 0.5, W - 1, alto - 1, { rx: 0, stroke: T.oro, sw: 1, op: 0.5 })}${P.join("")}</svg>`;
  return { svg, ancho: W, alto };
}

/** URLs de iconos que necesita el informe (el servidor las descarga y las incrusta). */
export function iconosInforme(inf) {
  const u = new Set();
  for (const o of Object.values(inf.objetos ?? {})) if (o?.i) u.add(o.i);
  for (const f of inf.crafteos ?? []) if (f.icono) u.add(f.icono);
  u.add(ICONO_RESPALDO);
  return [...u].filter((x) => ICONO_PERMITIDO.test(x));
}
/** Iconos que se aceptan: el CDN de Blizzard (catálogo) y los de AHledger (objetos que Blizzard no sirve). */
export const ICONO_PERMITIDO = /^https:\/\/(render\.worldofwarcraft\.com\/[A-Za-z0-9_./-]+|ahledger\.com\/icons\/[0-9]{1,12})\.(jpg|png)$/;

export { partesMoneda };
