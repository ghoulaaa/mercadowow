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

export const VERSION_INFORME = 2;
/** Cada página mide 800 × 600 (4:3) en unidades del dibujo: Discord muestra cada imagen en ~400 × 300 px. */
export const ANCHO_INFORME = 800;
export const ALTO_PAGINA = 600;
export const ARCHIVO_INFORME = "mercadowow-report.png";
export const FUENTE_TITULO = "Cinzel";
export const COLOR_EMBED = 0xE9BC65;

export const SECCIONES = Object.freeze([
  ["kpi", "Indicadores principales"], ["grafico", "Actividad de 24 h"], ["volumen", "Mayor volumen de oro"],
  ["consumibles", "Pociones y elixires más vendidos"], ["subidas", "Mayores subidas"], ["caidas", "Mayores caídas"],
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
const [ID, MED, MEDA, N, NA, Q, QA, ULT, QULT, SPD, SPDA, H30, NPC, CAT, SUB] = [...Array(15).keys()];
/** Subclases de consumible que entran en «Pociones y elixires más vendidos» (catálogo de Blizzard; sin comida). */
export const SUBCLASES_POCIONES = Object.freeze(["Potions", "Elixirs"]);
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
export function formatoPct(v, dec = 1) {
  if (v == null || !Number.isFinite(v)) return "Sin datos";
  const d = Math.abs(v) >= 100 ? 0 : dec, r = Math.round(v * 10 ** d) / 10 ** d;   // sin «−0 %»
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("es", { maximumFractionDigits: d })} %`;
}
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

  // ---- volumen de oro y pociones y elixires más vendidos (estimaciones)
  // Solo objetos que se venden de verdad (liquidez mínima) y con algo publicado.
  const conV = objs.filter((o) => o[SPD] >= Math.max(c.liquidez_min, 0.5) && o[MED] > 0 && o[Q] >= 1);
  const volumen = [...conV].sort((a, b) => b[SPD] * precioVolumen(b) - a[SPD] * precioVolumen(a)).slice(0, n)
    .map((o) => ({ id: o[ID], oro: Math.round(o[SPD] * precioVolumen(o)), unidades: o[SPD], precio: precioVolumen(o) }));
  const consumibles = conV.filter((o) => o[CAT] === "consumibles" && SUBCLASES_POCIONES.includes(o[SUB])).sort((a, b) => b[SPD] - a[SPD] || b[MED] - a[MED]).slice(0, n)
    .map((o) => ({ id: o[ID], unidades: o[SPD], precio: precioVolumen(o), oro: Math.round(o[SPD] * precioVolumen(o)),
                   variacion: fiable(o, minEscaneos) ? pctCambio(o[MED], o[MEDA]) : null }));

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
      neta: o.neta, roi: o.roi, demanda: o.ventas ?? null, score: o.score, riesgo: o.riesgo, enfriamiento: o.enfriamiento === true,
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
    kpi, volumen, consumibles, subidas, caidas,
    gangas: gangas.slice(0, n), gangasTotal: gangas.length,
    crafteos: crafts.slice(0, n), crafteosTotal: crafts.length,
    categorias, arbitraje, objetos: {}, destacados: [], resumen: "",
  };
}

/** IDs de objetos que aparecen en el informe (para pedir nombre, icono y calidad). */
export function idsInforme(inf) {
  const ids = new Set();
  for (const k of ["volumen", "consumibles", "subidas", "caidas", "gangas"]) for (const x of inf[k] ?? []) ids.add(x.id);
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
/**
 * Mensaje de Discord: el primer embed lleva el título enlazado, el resumen y la primera página; cada página más va
 * en su propio embed (sin enlace, para que Discord no las junte en una galería pequeña); el último, el pie y la hora.
 * `paginas`: las páginas que se adjuntan, en orden (archivoPagina(i) es el nombre de cada una).
 */
export function mensajeInforme(inf, { sitio = "", nombre = "MercadoWoW | Market Intelligence", avatar = null, manual = false, paginas = null } = {}) {
  const m = inf.mercado;
  const lugar = [`WoW Forever`, (m.region ?? "").toUpperCase(), REGLAS[m.reglas] ?? m.reglas, FACCIONES[m.faccion] ?? m.faccion].filter(Boolean).join(" · ");
  const periodo = `${fechaCorta(inf.desde, inf.zona)} – ${fechaCorta(inf.hasta, inf.zona)} (${inf.zona})`;
  const desc = [`**${lugar}** · ${fechaLocal(inf.hasta, inf.zona)}`, `Período: ${periodo}`, "", inf.resumen,
    sitio ? `\n[Abrir el panel de MercadoWoW](${sitio})` : ""].join("\n").slice(0, 4000);
  const lista = (paginas ?? paginasInforme(inf)).slice(0, 10);
  const pie = `MercadoWoW · Market Intelligence${manual ? " · Envío manual" : ""} · ${m.atribucion || (m.proveedor === "tsm" ? "Precios: TradeSkillMaster" : m.proveedor)}`;
  return {
    username: nombre, ...(avatar ? { avatar_url: avatar } : {}), allowed_mentions: { parse: [] },
    attachments: lista.map((p, i) => ({ id: i, filename: archivoPagina(i), description: `${TITULOS_PAGINA[p] ?? p} · ${inf.fecha}` })),
    embeds: lista.map((p, i) => ({
      ...(i === 0 ? { title: "Informe diario del mercado", ...(sitio ? { url: sitio } : {}), description: desc } : {}),
      color: COLOR_EMBED, image: { url: `attachment://${archivoPagina(i)}` },
      ...(i === lista.length - 1 ? { footer: { text: pie }, timestamp: new Date(inf.generado).toISOString() } : {}),
    })),
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
// Discord encaja la imagen de cada embed en ~400 × 300 px: un informe alto se encoge hasta no leerse. Por eso el
// informe son PÁGINAS apaisadas (800 × 600 en unidades del dibujo, 4:3) con letra grande, una por embed.
const T = {
  fondo: "#0E0E10", tarjeta: "#19191D", borde: "#2B2B30", oro: "#E9BC65", texto: "#F5EBD5", sec: "#A8A196",
  verde: "#8BCB70", rojo: "#E36B65", azul: "#65C4D9", plata: "#CBD5E1", cobre: "#E0965A", pista: "#26262B",
};
const W = ANCHO_INFORME, H = ALTO_PAGINA, M = 32, DER = W - M, CW = W - 2 * M;

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

/** Páginas del informe, en orden, según las secciones visibles y los datos. */
export function paginasInforme(inf) {
  const v = (k) => seccionVisible(inf.config, k);
  const p = [];
  if (v("kpi") || v("grafico")) p.push("resumen");
  if (v("volumen") || v("consumibles")) p.push("oro");
  if (v("subidas") || v("caidas")) p.push("cambios");
  if (v("gangas")) p.push("gangas");
  if (v("crafteos")) p.push("crafteos");
  if (v("arbitraje") && inf.arbitraje?.disponible) p.push("arbitraje");
  if (v("categorias")) p.push("categorias");
  if (v("destacados") || (v("arbitraje") && !inf.arbitraje?.disponible)) p.push("destacados");
  return p.length ? p : ["resumen"];
}
export const TITULOS_PAGINA = {
  resumen: "Informe diario del mercado", oro: "Oro, pociones y elixires", cambios: "Subidas y caídas · 24 h", gangas: "Gangas del día",
  crafteos: "Mejores crafteos del día", arbitraje: "Arbitraje entre facciones", categorias: "Comportamiento por categorías",
  destacados: "Datos interesantes del día",
};
/** Nombre del archivo de cada página (la primera, el del informe). */
export const archivoPagina = (i) => (i === 0 ? ARCHIVO_INFORME : `mercadowow-report-${i + 1}.png`);

/**
 * Dibuja una página del informe. `iconos`: {url: href} (en el servidor, los iconos incrustados en base64).
 * @returns {{svg: string, ancho: number, alto: number}}
 */
export function informeSVG(inf, { pagina = "resumen", iconos = {}, sitio = "" } = {}) {
  const c = inf.config ?? CONFIG_INFORME;
  const ver = (k) => seccionVisible(c, k);
  const P = [], defs = [];
  let nIco = 0;
  const m = inf.mercado, zona = inf.zona;
  const href = (u) => esc(iconos[u ?? ICONO_RESPALDO] ?? u ?? ICONO_RESPALDO);
  const icono = (url, x, y, s) => {
    const k = `ic${nIco++}`;
    defs.push(`<clipPath id="${k}"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${Math.round(s / 6)}"/></clipPath>`);
    return rect(x - 1, y - 1, s + 2, s + 2, { rx: Math.round(s / 6) + 1, fill: T.tarjeta, stroke: T.borde })
      + `<image href="${href(url)}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${k})"/>`;
  };
  const iconoObj = (id, x, y, s) => icono(inf.objetos?.[id]?.i ?? null, x, y, s);
  const nom = (id) => nombreDe(inf, id);
  const sec = (x, y, t) => P.push(texto(x, y, t.toUpperCase(), { tam: 22, peso: 700, color: T.oro, esp: 1.5, fuente: FUENTE_TITULO }));
  const nota = (x, y, t, ancla = "start") => P.push(texto(x, y, t, { tam: 16, color: T.sec, ancla }));
  // Nota de la página, encima del pie (el pie lleva la fuente de los precios).
  const notaPie = (t) => envolver(t, 16, 400, CW).slice(0, 2).forEach((l, j, a) => P.push(texto(M, H - 34 - (a.length - 1 - j) * 19, l, { tam: 16, color: T.sec })));
  const vacio = (y, t) => { P.push(rect(M, y, CW, 64, { rx: 12, fill: T.tarjeta, stroke: T.borde })); envolver(t, 20, 400, CW - 40).slice(0, 2).forEach((l, j) => P.push(texto(M + 20, y + 38 + j * 24, l, { tam: 20, color: T.sec }))); return 64; };
  const paginas = paginasInforme(inf), n = paginas.indexOf(pagina) + 1;
  const fuente = m.atribucion || (m.proveedor === "tsm" ? "Precios: TradeSkillMaster" : m.proveedor);
  const dominio = String(sitio || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const nVent = (v) => v.toLocaleString("es", { maximumFractionDigits: v < 10 ? 1 : 0, useGrouping: "always" });

  // ---- cabecera (en la portada, más grande)
  if (pagina === "resumen") {
    P.push(`<g fill="${T.oro}">${[[0, 10, 12], [9, 4, 18], [18, 0, 22]].map(([dx, dy, h]) => `<rect x="${M + dx}" y="${20 + dy}" width="6" height="${h}" rx="2"/>`).join("")}</g>`,
      texto(M + 34, 40, "MERCADOWOW", { tam: 22, peso: 700, color: T.oro, esp: 3, fuente: FUENTE_TITULO }));
    const lugar = [(m.region ?? "").toUpperCase(), REGLAS[m.reglas] ?? m.reglas, FACCIONES[m.faccion] ?? m.faccion].filter(Boolean).join(" · ");
    P.push(texto(DER, 30, `WoW Forever · ${lugar}`, { tam: 17, color: T.sec, ancla: "end" }), texto(DER, 52, fechaLocal(inf.hasta, zona), { tam: 17, color: T.sec, ancla: "end" }));
    P.push(texto(M, 96, "Informe diario del mercado", { tam: 38, peso: 700, color: T.oro, fuente: FUENTE_TITULO }));
    nota(M, 122, `Últimas 24 h hasta las ${horaLocal(inf.hasta, zona)} (${zona}) · página ${n} de ${paginas.length}`);
  } else {
    P.push(texto(M, 44, TITULOS_PAGINA[pagina], { tam: 28, peso: 700, color: T.oro, fuente: FUENTE_TITULO }),
      texto(DER, 42, `${fechaCorta(inf.hasta, zona)} · ${n}/${paginas.length}`, { tam: 17, color: T.sec, ancla: "end" }),
      linea(M, 62, DER, 62, T.borde));
  }

  if (pagina === "resumen") {
    let y = 140;
    if (ver("kpi")) {
      const k = inf.kpi, wk = (CW - 16) / 2, hk = 112;
      const vari = (v) => (v == null ? null : { t: `${formatoPct(v)} vs. ayer`, color: v > 0 ? T.verde : v < 0 ? T.rojo : T.sec, sube: v > 0 });
      const tarjetas = [
        { cifra: k.unidades ? formatoNumero(k.unidades.pico) : null, texto: k.unidades ? `unidades publicadas (máximo, ${horaLocal(k.unidades.picoMs, zona)})` : "unidades publicadas" },
        { cifra: k.unidades?.variacion != null ? formatoPct(k.unidades.variacion) : null, color: k.unidades?.variacion > 0 ? T.verde : k.unidades?.variacion < 0 ? T.rojo : T.texto,
          texto: "unidades publicadas vs. ayer (media)" },
        { cifra: k.oro ? oroRedondo(k.oro.total) : null, texto: "oro movido al día (estimación)", v: vari(k.oro?.variacion) },
        { cifra: k.vendidas ? formatoNumero(k.vendidas.total) : null, texto: "vendidas al día (estimación)", v: vari(k.vendidas?.variacion) },
      ];
      tarjetas.forEach((t, i) => {
        const x = M + (i % 2) * (wk + 16), yy = y + Math.floor(i / 2) * (hk + 12);
        P.push(rect(x, yy, wk, hk, { rx: 12, fill: T.tarjeta, stroke: T.borde }));
        P.push(t.cifra == null ? texto(x + 18, yy + 48, "Sin datos", { tam: 30, peso: 700, color: T.sec })
          : texto(x + 18, yy + 50, t.cifra, { tam: Math.min(40, Math.floor(40 * (wk - 36) / Math.max(1, anchoTexto(t.cifra, 40, 800)))), peso: 800, color: t.color ?? T.texto }));
        P.push(texto(x + 18, yy + 78, recortar(t.texto, 18, 400, wk - 36), { tam: 18, color: T.sec }));
        if (t.v) P.push(triangulo(x + 18, yy + 101, t.v.sube, t.v.color, 11), texto(x + 36, yy + 101, t.v.t, { tam: 17, peso: 600, color: t.v.color }));
      });
      y += 2 * hk + 12 + 20;
    }
    if (ver("grafico")) {
      const s = inf.serie.filter((p) => Number.isFinite(p[1]));
      const gTop = y, gBase = H - 44;
      nota(M, gTop + 4, "Unidades publicadas en cada escaneo válido · 24 h");
      if (s.length < 3) P.push(texto(M, gTop + 50, "Datos insuficientes: hacen falta al menos 3 escaneos válidos.", { tam: 20, color: T.sec }));
      else {
        const gx = M, gw = CW, gy = gTop + 18, gh = gBase - gy - 22;
        const vals = s.map((p) => p[1]);
        let lo = Math.min(...vals), hi = Math.max(...vals);
        const margen = (hi - lo) * 0.2 || hi * 0.05 || 1;
        lo = Math.max(0, lo - margen); hi += margen;
        const t0 = inf.desde, t1 = inf.hasta;
        const px = (t) => gx + ((t - t0) / (t1 - t0)) * gw, py = (v) => gy + gh - ((v - lo) / (hi - lo)) * gh;
        P.push(linea(gx, gy + gh, gx + gw, gy + gh, T.borde));
        for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) {
          const h = Number(horaLocal(t, zona).slice(0, 2));
          if (h % 6) continue;
          P.push(texto(px(t), gy + gh + 20, horaLocal(t, zona), { tam: 16, color: T.sec, ancla: "middle" }));
        }
        const pts = s.map((p) => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(" ");
        defs.push(`<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.oro}" stop-opacity=".25"/><stop offset="1" stop-color="${T.oro}" stop-opacity="0"/></linearGradient>`);
        P.push(`<polygon points="${px(s[0][0]).toFixed(1)},${gy + gh} ${pts} ${px(s.at(-1)[0]).toFixed(1)},${gy + gh}" fill="url(#area)"/>`,
          `<polyline points="${pts}" fill="none" stroke="${T.oro}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
        const u = inf.kpi.unidades;
        const marca = (ms, v, color, etiqueta, arriba) => {
          const x = px(ms), yy = py(v), w = anchoTexto(etiqueta, 17, 600);
          const ancla = x - w / 2 < gx ? "start" : x + w / 2 > gx + gw ? "end" : "middle";
          P.push(`<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="6" fill="${color}" stroke="${T.fondo}" stroke-width="2"/>`,
            texto(ancla === "start" ? x - 4 : ancla === "end" ? x + 4 : x, arriba ? yy - 12 : yy + 26, etiqueta, { tam: 17, peso: 600, color: T.texto, ancla }));
        };
        if (u) {
          marca(u.picoMs, u.pico, T.texto, `máx. ${formatoNumero(u.pico)} (${horaLocal(u.picoMs, zona)})`, true);
          marca(u.valleMs, u.valle, T.rojo, `mín. ${formatoNumero(u.valle)} (${horaLocal(u.valleMs, zona)})`, py(u.valle) > gy + gh - 34);
        }
      }
    }
  }

  // Lista de una sección: filas de 40 de alto con icono, nombre y cifras a la derecha.
  const lista = (y, titulo, filas, { vacioTxt, max = 5, fila }) => {
    sec(M, y, titulo);
    let yy = y + 14;
    if (!filas.length) return yy - y + vacio(yy, vacioTxt) + 8;
    for (const f of filas.slice(0, max)) { fila(f, yy); yy += 40; }
    return yy - y;
  };
  if (pagina === "oro") {
    let y = 88;
    const max = Math.min(5, c.por_seccion);
    const filaOro = (barColor, valorDe, barraDe, maxV) => (f, yy) => {
      P.push(iconoObj(f.id, M, yy + 6, 30), texto(M + 42, yy + 28, recortar(nom(f.id), 21, 500, 300), { tam: 21, peso: 500, color: T.texto }));
      P.push(barra(M + 360, yy + 17, 110, 10, barraDe(f) / maxV, barColor, T));
      P.push(texto(M + 600, yy + 28, `≈ ${nVent(f.unidades)}/día`, { tam: 18, color: T.sec, ancla: "end" }));
      P.push(valorDe(f, yy));
    };
    if (ver("volumen")) {
      const fs = inf.volumen ?? [];
      const maxV = Math.max(1, ...fs.map((f) => f.oro));
      y += lista(y, "Mayor volumen de oro", fs, { max, vacioTxt: "Sin estimaciones de ventas para este mercado.",
        fila: filaOro(T.oro, (f, yy) => texto(DER, yy + 28, oroRedondo(f.oro), { tam: 21, peso: 700, color: T.texto, ancla: "end" }), (f) => f.oro, maxV) }) + 22;
    }
    if (ver("consumibles")) {
      const fs = inf.consumibles ?? [];
      const maxV = Math.max(1, ...fs.map((f) => f.unidades));
      lista(y, "Pociones y elixires más vendidos", fs, { max, vacioTxt: "Sin estimaciones de ventas de pociones ni elixires en este mercado.",
        fila: filaOro(T.azul, (f, yy) => moneda(DER, yy + 28, f.precio, { tam: 21, peso: 700, color: T.texto, ancla: "end", ap: {}, T }), (f) => f.unidades, maxV) });
    }
    notaPie("Estimaciones de ventas. Arriba: oro movido al día; abajo: precio por unidad.");
  }

  if (pagina === "cambios") {
    let y = 88;
    const max = Math.min(5, c.por_seccion);
    const filaCambio = (sube) => (f, yy) => {
      const color = sube ? T.verde : T.rojo;
      P.push(iconoObj(f.id, M, yy + 6, 30), texto(M + 42, yy + 28, recortar(nom(f.id), 21, 500, 330), { tam: 21, peso: 500, color: T.texto }));
      P.push(texto(M + 610, yy + 28, `${textoMoneda(f.antes)} → ${textoMoneda(f.ahora)}`, { tam: 18, color: f.compra ? T.verde : T.sec, ancla: "end" }));
      const t = formatoPct(f.pct, 0).replace("+", "");
      P.push(texto(DER, yy + 29, t, { tam: 23, peso: 800, color, ancla: "end" }), triangulo(DER - anchoTexto(t, 23, 800) - 20, yy + 26, sube, color, 12));
    };
    if (ver("subidas")) y += lista(y, "Mayores subidas", inf.subidas, { max, vacioTxt: "Ninguna subida fiable de al menos un 5 %.", fila: filaCambio(true) }) + 22;
    if (ver("caidas")) lista(y, "Mayores caídas", inf.caidas, { max, vacioTxt: "Ninguna caída fiable de al menos un 5 %.", fila: filaCambio(false) });
    notaPie("Mediana de 24 h frente a las 24 h anteriores · en verde: posible compra.");
  }

  // Tarjetas grandes (gangas, crafteos): 5 como mucho, 98 de alto.
  const tarjetas = (filas, dibujar, vacioTxt) => {
    let y = 76;
    if (!filas.length) { vacio(y, vacioTxt); return; }
    for (const f of filas.slice(0, Math.min(5, c.por_seccion))) { P.push(rect(M, y, CW, 86, { rx: 12, fill: T.tarjeta, stroke: T.borde })); dibujar(f, y); y += 92; }
  };
  if (pagina === "gangas") {
    tarjetas(inf.gangas, (g, y) => {
      P.push(iconoObj(g.id, M + 14, y + 12, 40), texto(M + 66, y + 28, recortar(nom(g.id), 22, 700, 480), { tam: 22, peso: 700, color: T.texto }));
      P.push(texto(DER - 16, y + 50, `−${Math.round(g.descuento)} %`, { tam: 34, peso: 800, color: T.verde, ancla: "end" }));
      P.push(texto(M + 66, y + 53, `Compra ${textoMoneda(g.compra)} → reventa ${textoMoneda(g.reventa)} · referencia ${textoMoneda(g.referencia)}`, { tam: 18, color: T.texto }));
      P.push(texto(M + 66, y + 75, `Beneficio +${textoMoneda(g.neta)} · ROI ${formatoPct(g.roi, 0).replace("+", "")} · ≈ ${nVent(g.liquidez)} ventas/día · confianza ${g.confianza}`,
        { tam: 17, color: T.sec }));
    }, "Ninguna ganga con los criterios actuales.");
    notaPie(`Descuento ≥ ${c.gangas_desc_min} % frente a sus medianas de 7 y 30 días · beneficio tras comisión.`);
  }
  if (pagina === "crafteos") {
    const maxRoi = Math.max(100, ...inf.crafteos.map((f) => f.roi));
    tarjetas(inf.crafteos, (f, y) => {
      P.push(icono(f.icono, M + 14, y + 12, 40), texto(M + 66, y + 28, recortar(f.nombre, 22, 700, 440), { tam: 22, peso: 700, color: T.texto }));
      P.push(texto(DER - 16, y + 32, `${formatoPct(f.roi, 0).replace("+", "")}`, { tam: 28, peso: 800, color: T.verde, ancla: "end" }));
      P.push(texto(M + 66, y + 53, recortar(`${nombreProfesion(f.profesion)} · coste ${textoMoneda(f.coste)} → venta ${textoMoneda(f.venta)}${f.enfriamiento ? " · 1 cada pocos días" : ` · comisión ${textoMoneda(f.comision)}`}`, 17, 400, CW - 66 - 32),
        { tam: 17, color: f.enfriamiento ? T.oro : T.sec }));
      P.push(texto(M + 66, y + 76, `Beneficio +${textoMoneda(f.neta)}`, { tam: 18, peso: 700, color: T.verde }),
        texto(DER - 16, y + 76, f.demanda != null ? `demanda ≈ ${nVent(f.demanda)}/día` : "demanda sin datos", { tam: 17, color: T.sec, ancla: "end" }));
      P.push(barra(M + 300, y + 69, 250, 8, f.roi / maxRoi, T.verde, T));
    }, "Ningún crafteo cumple los mínimos con los precios actuales.");
    notaPie(`ROI ≥ ${c.craft_roi_min} % y beneficio ≥ ${textoMoneda(c.neta_min)} · cálculo de fabricación de MercadoWoW.`);
  }
  if (pagina === "arbitraje") {
    const a = inf.arbitraje;
    let y = 92;
    if (!a.filas.length) vacio(76, "Ninguna diferencia aprovechable con los criterios actuales.");
    for (const f of a.filas.slice(0, 5)) {
      P.push(iconoObj(f.id, M, y, 36), texto(M + 48, y + 18, recortar(nom(f.id), 21, 600, 560), { tam: 21, peso: 600, color: T.texto }),
        texto(M + 48, y + 42, `${a.facA} ${textoMoneda(f.precioA)} · ${a.facB} ${textoMoneda(f.precioB)} · más barato en ${f.barata}`, { tam: 17, color: T.sec }),
        texto(DER, y + 30, formatoVeces(f.veces), { tam: 28, peso: 800, color: T.azul, ancla: "end" }));
      y += 92;
    }
    notaPie(`Estimación con ${c.comision_neutral_pct} % de comisión; requiere mover el objeto entre facciones. No es un beneficio garantizado.`);
  }
  if (pagina === "categorias") {
    const wc = (CW - 2 * 12) / 3, hc = 100;
    inf.categorias.forEach((k, i) => {
      const x = M + (i % 3) * (wc + 12), y = 76 + Math.floor(i / 3) * (hc + 10);
      const color = k.tendencia === "sube" ? T.verde : k.tendencia === "baja" ? T.rojo : T.sec;
      P.push(rect(x, y, wc, hc, { rx: 12, fill: T.tarjeta, stroke: T.borde }), texto(x + 16, y + 28, recortar(k.nombre, 19, 600, wc - 32), { tam: 19, peso: 600, color: T.texto }));
      if (k.variacion == null) P.push(texto(x + 16, y + 66, "Sin datos", { tam: 24, peso: 700, color: T.sec }));
      else P.push(texto(x + 16, y + 66, formatoPct(k.variacion), { tam: 30, peso: 800, color }),
        texto(x + 16, y + 89, `▼ ${k.bajan} · ▲ ${k.suben} de ${k.total}`, { tam: 16, color: T.sec }));
    });
    notaPie("Mediana de la variación de precio frente a ayer · ▼ bajan / ▲ suben más de un 2 %.");
  }
  if (pagina === "destacados") {
    const ds = ver("destacados") ? inf.destacados : [];
    const wd = (CW - 16) / 2, hd = 172;
    const colores = { verde: T.verde, rojo: T.rojo, oro: T.oro, texto: T.texto };
    ds.forEach((d, i) => {
      const x = M + (i % 2) * (wd + 16), y = 76 + Math.floor(i / 2) * (hd + 14);
      P.push(rect(x, y, wd, hd, { rx: 12, fill: T.tarjeta, stroke: T.borde }));
      let xc = x + 18;
      if (d.id != null) { P.push(iconoObj(d.id, x + 18, y + 20, 40)); xc += 52; }
      P.push(texto(xc, y + 54, recortar(d.cifra, 34, 800, x + wd - 18 - xc), { tam: 34, peso: 800, color: colores[d.color] ?? T.texto }));
      envolver(d.texto, 20, 400, wd - 36).slice(0, 4).forEach((l, j) => P.push(texto(x + 18, y + 94 + j * 25, l, { tam: 20, color: T.sec })));
    });
    if (!ds.length && ver("destacados")) vacio(76, "Sin datos destacados hoy.");
    let y = 76 + Math.ceil(ds.length / 2) * (hd + 14) + 10;
    if (ver("arbitraje") && !inf.arbitraje?.disponible) {
      envolver(`Arbitraje entre facciones: ${(inf.arbitraje?.motivo ?? "Sin datos de la otra facción.").replace(/^./, (x) => x.toLowerCase())}`, 18, 400, CW).slice(0, 2)
        .forEach((l, j) => P.push(texto(M, y + 18 + j * 22, l, { tam: 18, color: T.sec })));
    }
    notaPie(`${inf.kpi.escaneos} escaneos válidos (${inf.kpi.descartados} incompletos descartados). Ventas y oro: estimaciones (un escaneo no distingue venta de cancelación). Iconos: Blizzard Entertainment. No afiliado con Blizzard.`);
  }

  // ---- pie común: fuente de los precios (obligatoria con AHledger) y web
  P.push(texto(M, H - 12, fuente, { tam: 15, color: T.sec }));
  if (dominio) P.push(texto(DER, H - 12, dominio, { tam: 15, peso: 600, color: T.oro, ancla: "end" }));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<defs>${defs.join("")}</defs>${rect(0, 0, W, H, { fill: T.fondo })}${rect(0, 0, W, 4, { fill: T.oro })}`
    + `${rect(0.5, 0.5, W - 1, H - 1, { rx: 0, stroke: T.borde })}${P.join("")}</svg>`;
  return { svg, ancho: W, alto: H };
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