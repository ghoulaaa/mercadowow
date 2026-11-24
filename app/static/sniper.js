// MercadoWoW Crafting Sniper: motor de detección de oportunidades de fabricación. Sin DOM ni red: se prueba en
// Node y se copia tal cual a la Edge Function (npm run motor), que lo ejecuta en el servidor sin la página abierta.
//
// Los cálculos de coste, venta, comisión, ganancia, ROI y margen NO están aquí: son los de calcularFilas()
// (fabricacion_tabla.js), los mismos que ve la página. Este módulo añade lo propio del aviso:
//   · clasificación por ROI (umbrales configurables);
//   · MercadoWoW Score (0–100) con su desglose y su nivel de confianza;
//   · protección contra falsas gangas (precio frente a sus medianas de 24 h, 7 d y 30 d, escaneo viejo,
//     sin ventas registradas, materiales insuficientes) y un escenario conservador;
//   · decisión de enviar o no (sin repetir lo mismo) y el mensaje para Discord;
//   · plan de fabricación con un presupuesto.
// Nada se inventa: un dato que no existe queda como null y baja la confianza; no se rellena con estimaciones.

import { calcularFilas } from "./fabricacion_tabla.js";
import { REGLA_POR_DEFECTO, comisionVenta } from "./fabricacion.js";
import { indicadores } from "./oportunidades.js";
import { formatearMoneda } from "./moneda.js";

// ---------- clasificación por ROI ----------
export const CLASES = Object.freeze([
  { clave: "no_rentable", nombre: "No rentable", emoji: "🔴", color: 0xF07878, rango: 0 },
  { clave: "baja", nombre: "Rentabilidad baja", emoji: "⚪", color: 0x9D9D9D, rango: 1 },
  { clave: "rentable", nombre: "Rentable", emoji: "🟢", color: 0x1EFF00, rango: 2 },
  { clave: "ganga", nombre: "Ganga", emoji: "🔵", color: 0x0070DD, rango: 3 },
  { clave: "epica", nombre: "Ganga épica", emoji: "🟣", color: 0xA335EE, rango: 4 },
  { clave: "legendaria", nombre: "Ganga legendaria", emoji: "🟠", color: 0xFF8000, rango: 5 },
  { clave: "excepcional", nombre: "Ganga excepcional", emoji: "🔥", color: 0xE6CC80, rango: 6 },
]);
const CLASE = Object.fromEntries(CLASES.map((c) => [c.clave, c]));
/** Límite inferior (ROI %) de cada clase. «No rentable» es ROI ≤ 0. */
export const UMBRALES_DEFECTO = Object.freeze({ rentable: 15, ganga: 30, epica: 60, legendaria: 100, excepcional: 200 });

/** Clase según el ROI neto (%). Sin ROI (receta incompleta): no rentable. */
export function clasificar(roi, umbrales = UMBRALES_DEFECTO) {
  const u = { ...UMBRALES_DEFECTO, ...(umbrales ?? {}) };
  if (roi == null || !Number.isFinite(roi) || roi <= 0) return CLASE.no_rentable;
  for (const k of ["excepcional", "legendaria", "epica", "ganga", "rentable"]) if (roi >= u[k]) return CLASE[k];
  return CLASE.baja;
}
export const claseDe = (clave) => CLASE[clave] ?? CLASE.no_rentable;

// ---------- configuración ----------
export const RIESGOS = Object.freeze(["bajo", "medio", "alto"]);
export const CONFIG_DEFECTO = Object.freeze({
  activo: false,
  roi_min: 30,                // %
  neta_min: 10000,            // cobre por fabricación (1 oro)
  score_min: 60,
  riesgo_max: "medio",
  profesiones: [],            // vacío = todas
  incluir: [],                // IDs de objetos: si hay alguno, SOLO esos
  excluir: [],
  espera_repetir_min: 360,    // no repetir la misma oportunidad antes de 6 h…
  mejora_pct: 20,             // …salvo que la ganancia suba un 20 %
  bajada_coste_pct: 15,       // …o el coste baje un 15 %
  edad_max_min: 180,          // con un escaneo más viejo no se avisa
  comision_pct: 5,
  recorte_pct: 5,             // escenario conservador: se vende un 5 % por debajo (competencia)
  max_por_ronda: 10,
  umbrales: { ...UMBRALES_DEFECTO },
  mencion_rol: null,
  mencion_desde: "excepcional",
});

/** Configuración guardada con los valores por defecto para lo que falte. No valida: eso lo hace SQL. */
export const normalizarConfig = (c) => ({ ...CONFIG_DEFECTO, ...(c ?? {}), umbrales: { ...UMBRALES_DEFECTO, ...(c?.umbrales ?? {}) } });

// ---------- protección contra falsas gangas ----------
const minutosDesde = (iso, ahora) => (iso ? (ahora - new Date(iso)) / 60000 : null);

/**
 * Motivos para NO avisar o para bajar la confianza. `h`: historial de compra mínima del producto
 * {m24, m7, m30, n7, n30} (medianas y número de escaneos) o null. `i`: indicadores() de oportunidades.js.
 * @returns {{bloquea: string[], avisos: string[], confianza: "alta"|"media"|"baja"}}
 */
export function revisarOportunidad(x, i, h, { escaneo, ahora, edadMaxMin = CONFIG_DEFECTO.edad_max_min } = {}) {
  const bloquea = [], avisos = [];
  const edad = minutosDesde(escaneo, ahora);
  if (edad == null) bloquea.push("Sin escaneo de precios");
  else if (edad > edadMaxMin) bloquea.push(`El último escaneo es de hace ${Math.round(edad)} min: los precios pueden haber cambiado`);
  const v = x.precioVenta;
  if (v != null && h) {
    if (h.m7 != null && v > 2 * h.m7) bloquea.push(`El precio de venta es ${(v / h.m7).toFixed(1)} veces su mediana de 7 días`);
    else if (h.m30 != null && v > 2 * h.m30) bloquea.push(`El precio de venta es ${(v / h.m30).toFixed(1)} veces su mediana de 30 días`);
    if (h.m24 != null && v > 1.5 * h.m24) avisos.push("El precio de venta subió más de un 50 % en 24 h");
  }
  if (!h || !(h.n7 >= 3)) avisos.push("Poco historial de precios del producto (menos de 3 escaneos en 7 días)");
  if (i.sospechoso) bloquea.push(...i.motivosSospecha);
  if (i.demanda === "nula") bloquea.push(i.regional ? "Sin ventas registradas en la región" : "Sin ventas registradas en el reino");
  if (i.demanda === "sin_dato") avisos.push("Ninguna fuente publica ventas de este objeto");
  if (x.ventaSinOfertas) avisos.push("El producto no tiene ofertas ahora: la venta es su valor de mercado");
  if (x.materialesSinOfertas?.length) avisos.push("Algún material no tiene ofertas ahora: se usa su valor de mercado");
  if (x.a.maxFabricable?.veces === 0) bloquea.push("No hay materiales publicados suficientes para fabricarlo ni una vez");
  if (i.espera) avisos.push("Puede tener tiempo de espera entre fabricaciones (en Classic; sin verificar en Forever)");
  // Confianza: alta con historial, ventas y ofertas reales; baja si faltan las ventas o el historial.
  const faltanVentas = i.demanda === "sin_dato", pocoHistorial = !h || !(h.n7 >= 3);
  const confianza = faltanVentas || pocoHistorial ? "baja" : avisos.length ? "media" : "alta";
  return { bloquea, avisos, confianza };
}

/**
 * Escenario conservador: se vende al menor entre el precio actual y sus medianas de 7 y 30 días, y además
 * un `recorte_pct` más barato para ganar a la competencia. Misma comisión y mismo coste. Cobre entero.
 */
export function escenarioConservador(x, h, { comision_pct = 5, recorte_pct = 5 } = {}) {
  if (x.precioVenta == null || x.coste == null) return { precio: null, neta: null, roi: null };
  const refs = [x.precioVenta, h?.m7, h?.m30].filter((v) => Number.isFinite(v) && v > 0);
  const precio = Math.floor(Math.min(...refs) * (1 - recorte_pct / 100));
  const bruto = Math.floor(precio * x.a.unidadesProducidas);
  const neta = bruto - comisionVenta(bruto, { ...REGLA_POR_DEFECTO, comision_pct }) - x.coste;
  return { precio, neta, roi: x.coste > 0 ? (neta / x.coste) * 100 : null };
}

// ---------- MercadoWoW Score ----------
export const PESOS = Object.freeze({ rentabilidad: 30, demanda: 25, estabilidad: 15, materiales: 15, competencia: 10, actualidad: 5 });
const lim = (v) => Math.max(0, Math.min(1, v));

/**
 * Puntuación 0–100 y su desglose. Lo que no se sabe puntúa 0 en su apartado (no se supone nada) y se dice.
 * Rentabilidad: ROI del escenario conservador (150 % = máximo). Demanda: ventas al día (10/día = máximo;
 * las regionales valen un 80 %). Estabilidad: cuánto se aleja el precio de su mediana de 7 días (±50 % = 0).
 * Materiales: fabricaciones posibles con lo publicado (20 = máximo; los del NPC o fabricados no limitan).
 * Competencia: días para venderse lo ya publicado. Actualidad: antigüedad del escaneo.
 */
export function puntuar(x, i, h, cons, { escaneo, ahora } = {}) {
  const p = {}, desconocido = [];
  p.rentabilidad = cons.roi == null ? 0 : PESOS.rentabilidad * lim(cons.roi / 150);
  if (i.ventas == null) { p.demanda = 0; desconocido.push("demanda"); }
  else p.demanda = PESOS.demanda * lim(Math.log10(1 + i.ventas) / Math.log10(11)) * (i.regional ? 0.8 : 1);
  if (h?.m7 != null && x.precioVenta != null) p.estabilidad = PESOS.estabilidad * lim(1 - Math.abs(x.precioVenta / h.m7 - 1) / 0.5);
  else { p.estabilidad = 0; desconocido.push("estabilidad"); }
  const mf = x.a.maxFabricable ?? {};
  if (mf.ilimitado) p.materiales = PESOS.materiales;
  else if (mf.veces == null) { p.materiales = 0; desconocido.push("materiales"); }
  else p.materiales = PESOS.materiales * lim(mf.veces / 20);
  if (x.materialesSinOfertas?.length) p.materiales *= 0.5;
  const comp = { ninguna: 1, baja: 1, media: 0.6, alta: 0.2 }[i.competencia];
  if (comp == null) { p.competencia = 0; desconocido.push("competencia"); } else p.competencia = PESOS.competencia * comp;
  const edad = minutosDesde(escaneo, ahora);
  p.actualidad = edad == null ? 0 : edad <= 60 ? PESOS.actualidad : edad <= 180 ? PESOS.actualidad * 0.6 : 0;
  for (const k of Object.keys(p)) p[k] = Math.round(p[k] * 10) / 10;
  return { score: Math.round(Object.values(p).reduce((s, v) => s + v, 0)), partes: p, desconocido };
}

/** Riesgo: el de los indicadores (bajo/medio/alto) o «desconocido» si falta lo esencial para juzgarlo. */
export function riesgoDe(i, rev) {
  if (rev.bloquea.length) return "alto";
  if (i.demanda === "sin_dato" && rev.confianza === "baja") return "desconocido";
  return i.riesgo;
}

// ---------- evaluación completa ----------
/**
 * Evalúa todas las recetas del mercado. `datos`: respuesta de datos_fabricacion(); `hist`: {id: {m24, m7, m30,
 * n7, n30, wh}} del producto; `cfg`: configuración. Devuelve las oportunidades que pasan los filtros (ordenadas
 * por score) y el recuento de descartadas por motivo.
 */
export function evaluar(datos, hist, cfg, ahora = Date.now()) {
  const c = normalizarConfig(cfg);
  const regla = { ...REGLA_POR_DEFECTO, comision_pct: Number(c.comision_pct) };
  const filas = calcularFilas(datos, { regla });
  const profs = c.profesiones?.length ? new Set(c.profesiones) : null;
  const incluir = c.incluir?.length ? new Set(c.incluir) : null;
  const excluir = new Set(c.excluir ?? []);
  const orden = { bajo: 0, medio: 1, alto: 2, desconocido: 3 };
  const descartes = {};
  const descartar = (m) => { descartes[m] = (descartes[m] ?? 0) + 1; };
  const lista = [];
  for (const x of filas) {
    if (!x.completo || x.neta == null) { descartar("Precios incompletos"); continue; }
    if (x.neta <= 0) { descartar("No rentable"); continue; }
    if (profs && !profs.has(x.profesion)) { descartar("Profesión no elegida"); continue; }
    if (incluir && !incluir.has(x.id)) { descartar("Objeto no elegido"); continue; }
    if (excluir.has(x.id)) { descartar("Objeto excluido"); continue; }
    const o = evaluarFila(x, datos, hist?.[x.id] ?? null, c, ahora);
    const motivo = !o.alertable ? "Datos poco fiables o precio sospechoso"
      : o.roi < c.roi_min ? "ROI por debajo del mínimo"
      : o.neta < c.neta_min ? "Ganancia por debajo del mínimo"
      : o.score < c.score_min ? "Score por debajo del mínimo"
      : orden[o.riesgo] > orden[c.riesgo_max] ? "Riesgo por encima del permitido"
      : null;
    o.motivoDescarte = motivo;
    if (motivo) descartar(motivo);
    lista.push(o);
  }
  lista.sort((p, q) => q.score - p.score || q.neta - p.neta || p.spell - q.spell);
  return { oportunidades: lista.filter((o) => !o.motivoDescarte), todas: lista, descartes, recetas: filas.length };
}

/** Una receta con todo lo que necesita el aviso y el panel. */
export function evaluarFila(x, datos, h, cfg, ahora = Date.now()) {
  const c = normalizarConfig(cfg);
  const i = indicadores(x, datos.objetos ?? {});
  const rev = revisarOportunidad(x, i, h, { escaneo: datos.escaneo, ahora, edadMaxMin: c.edad_max_min });
  const cons = escenarioConservador(x, h, c);
  const s = puntuar(x, i, h, cons, { escaneo: datos.escaneo, ahora });
  const riesgo = riesgoDe(i, rev);
  const clase = clasificar(x.roi, c.umbrales);
  const o = datos.objetos?.[x.id] ?? {};
  return {
    spell: x.spell, receta: x.receta, id: x.id, nombre: x.nombre, icono: x.icono, calidad: x.calidad,
    profesion: x.profesion, nivel: x.nivel,
    materiales: x.a.materiales.map((m) => ({
      id: m.id, nombre: datos.objetos?.[m.id]?.n ?? `#${m.id}`, cantidad: m.cantidad, precioUnitario: m.precioUnitario,
      costeTotal: m.costeTotal, origen: m.origen, sinOfertas: x.materialesSinOfertas.includes(m.id),
    })),
    unidades: x.a.unidadesProducidas, coste: x.coste, precioVenta: x.precioVenta, ingresoBruto: x.a.ingresoBruto,
    comision: x.a.comision, deposito: x.a.deposito, neta: x.neta, roi: x.roi, margen: x.margen, equilibrio: x.a.precioEquilibrio,
    historico: { tsm: Number.isFinite(o.h) ? o.h : null, m24: h?.m24 ?? null, m7: h?.m7 ?? null, m30: h?.m30 ?? null },
    maxFabricable: x.a.maxFabricable?.ilimitado ? null : x.a.maxFabricable?.veces ?? null,
    ventas: i.ventas, regional: i.regional, competencia: i.competencia, demanda: i.demanda,
    conservador: cons, score: s.score, partes: s.partes, desconocido: s.desconocido,
    riesgo, motivosRiesgo: i.motivosRiesgo, confianza: rev.confianza, bloquea: rev.bloquea, avisos: rev.avisos,
    // Solo se avisa con datos que lo respaldan: nada que bloquee, confianza no baja y ganancia también en el
    // escenario conservador.
    alertable: rev.bloquea.length === 0 && rev.confianza !== "baja" && cons.neta != null && cons.neta > 0,
    clase: clase.clave, wowhead: typeof h?.wh === "string" ? h.wh : null,
  };
}

// ---------- no repetir avisos ----------
export const claveOportunidad = (mercado, spell) => `${mercado}|${spell}`;

/**
 * ¿Se envía? `previo`: último aviso de esa receta en ese mercado {enviado, neta, coste, clase, desaparecida}
 * o null. Se envía si es nueva, si volvió tras desaparecer, si sube de clase, si la ganancia sube o el coste
 * baja lo suficiente, o si pasó el intervalo de repetición.
 */
export function decidirEnvio(o, previo, cfg, ahora = Date.now()) {
  const c = normalizarConfig(cfg);
  if (!previo) return { enviar: true, motivo: "Oportunidad nueva" };
  if (previo.desaparecida) return { enviar: true, motivo: "Vuelve a estar disponible" };
  if (claseDe(o.clase).rango > claseDe(previo.clase).rango) return { enviar: true, motivo: "Mejora su clasificación" };
  if (previo.neta > 0 && o.neta >= previo.neta * (1 + c.mejora_pct / 100)) return { enviar: true, motivo: "Sube la ganancia" };
  if (previo.coste > 0 && o.coste <= previo.coste * (1 - c.bajada_coste_pct / 100)) return { enviar: true, motivo: "Baja el coste de fabricación" };
  if ((ahora - new Date(previo.enviado)) / 60000 >= c.espera_repetir_min) return { enviar: true, motivo: "Pasó el intervalo de repetición" };
  return { enviar: false, motivo: "Ya avisada" };
}

// ---------- mensaje de Discord ----------
const PROF_ES = {
  Alchemy: "Alquimia", Blacksmithing: "Herrería", Cooking: "Cocina", Enchanting: "Encantamiento", Engineering: "Ingeniería",
  "First Aid": "Primeros auxilios", Herbalism: "Herboristería", Leatherworking: "Peletería", Mining: "Minería",
  Skinning: "Desuello", Tailoring: "Sastrería", Fishing: "Pesca", Jewelcrafting: "Joyería", Inscription: "Inscripción",
};
export const nombreProfesion = (p) => PROF_ES[p] ?? p;
const corta = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const m = (c) => formatearMoneda(c);
const pct = (v) => (v == null ? "—" : `${v.toLocaleString("es", { maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 1 : 0 })} %`);
const NIVEL_RIESGO = { bajo: "🟢 Bajo", medio: "🟡 Medio", alto: "🔴 Alto", desconocido: "⚪ Desconocido" };

/**
 * Mensaje (webhook de Discord) de una oportunidad. Límites de Discord respetados: título ≤ 256, campos ≤ 25,
 * valor ≤ 1024, total < 6000. `nombreDe(id, en)`: nombre en español si se conoce.
 */
export function mensajeDiscord(o, { sitio, mercado, ahora = Date.now(), motivo = null, manual = false, mencion = null, nombreDe = (id, en) => en } = {}) {
  const clase = claseDe(o.clase);
  const nombre = nombreDe(o.id, o.nombre);
  const url = sitio ? `${sitio.replace(/\/+$/, "")}/#/objeto/${o.id}` : null;
  const materiales = o.materiales.slice(0, 12).map((x) =>
    `${x.cantidad} × ${corta(nombreDe(x.id, x.nombre), 40)} — ${m(x.costeTotal)}${x.sinOfertas ? " (valor de mercado)" : x.origen === "fabricar" ? " (fabricado)" : x.origen === "npc" ? " (NPC)" : ""}`);
  if (o.materiales.length > 12) materiales.push(`y ${o.materiales.length - 12} más`);
  const hist = [o.historico.m7 != null ? `mediana 7 d ${m(o.historico.m7)}` : null, o.historico.m30 != null ? `30 d ${m(o.historico.m30)}` : null,
    o.historico.tsm != null ? `histórico TSM ${m(o.historico.tsm)}` : null].filter(Boolean).join(" · ") || "Sin historial";
  const ventas = o.ventas == null ? "Sin datos" : `${o.ventas.toLocaleString("es", { maximumFractionDigits: 1 })}/día${o.regional ? " (región)" : ""}`;
  const campos = [
    { name: "Coste de fabricación", value: m(o.coste), inline: true },
    { name: o.unidades === 1 ? "Precio de venta" : `Venta (${o.unidades} u.)`, value: `${m(o.ingresoBruto)}${o.unidades === 1 ? "" : `\n${m(o.precioVenta)} c/u`}`, inline: true },
    { name: "Comisión", value: `${m(o.comision)}`, inline: true },
    { name: "Beneficio neto", value: `**+${m(o.neta)}**`, inline: true },
    { name: "ROI", value: `**${pct(o.roi)}**`, inline: true },
    { name: "Margen", value: pct(o.margen), inline: true },
    { name: "MercadoWoW Score", value: `**${o.score}/100** · confianza ${o.confianza}`, inline: true },
    { name: "Riesgo", value: NIVEL_RIESGO[o.riesgo] ?? o.riesgo, inline: true },
    { name: "Ventas", value: ventas, inline: true },
    { name: "Escenario conservador", value: o.conservador.neta == null ? "—" : `${o.conservador.neta >= 0 ? "+" : ""}${m(o.conservador.neta)} (venta a ${m(o.conservador.precio)})`, inline: true },
    { name: "Equilibrio", value: `${m(o.equilibrio)} c/u`, inline: true },
    { name: "Máx. fabricable", value: o.maxFabricable == null ? "Sin límite conocido" : `${o.maxFabricable.toLocaleString("es")} veces`, inline: true },
    { name: "Precio de referencia", value: corta(hist, 1024) },
    { name: "Materiales", value: corta(materiales.join("\n") || "—", 1024) },
  ];
  const avisos = [...o.avisos].slice(0, 4);
  if (avisos.length) campos.push({ name: "A tener en cuenta", value: corta(avisos.map((a) => `• ${a}`).join("\n"), 1024) });
  const enlaces = [url ? `[Ver en MercadoWoW](${url})` : null, o.wowhead ? `[Wowhead](${o.wowhead})` : null].filter(Boolean).join(" · ");
  if (enlaces) campos.push({ name: "Enlaces", value: enlaces });
  const embed = {
    author: { name: corta(`${clase.emoji} ${clase.nombre.toUpperCase()} DETECTADA${manual ? " · ENVÍO MANUAL" : ""}`, 256) },
    title: corta(nombre, 256),
    ...(url ? { url } : {}),
    description: corta(`Profesión: **${nombreProfesion(o.profesion)}**${o.nivel != null ? ` (nivel ${o.nivel})` : ""} · ${mercado}`
      + (motivo ? `\n${motivo}` : ""), 4096),
    color: clase.color,
    fields: campos.slice(0, 25),
    footer: { text: "MercadoWoW · Crafting Sniper · estimación con el último escaneo; no garantiza la venta" },
    timestamp: new Date(ahora).toISOString(),
  };
  if (o.icono) embed.thumbnail = { url: o.icono };
  const conMencion = mencion && /^\d{5,25}$/.test(mencion);
  return {
    username: "MercadoWoW Sniper",
    ...(conMencion ? { content: `<@&${mencion}>` } : {}),
    allowed_mentions: conMencion ? { roles: [mencion] } : { parse: [] },
    embeds: [embed],
  };
}

/** Mensaje de prueba: dice que la conexión funciona, sin cifras inventadas. */
export function mensajePrueba({ sitio, ahora = Date.now() } = {}) {
  return {
    username: "MercadoWoW Sniper",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "Notificación de prueba",
      description: "La conexión entre MercadoWoW y este canal funciona. Las alertas llegarán aquí cuando se detecte una oportunidad que cumpla tu configuración.",
      color: 0xD6AF58,
      ...(sitio ? { url: sitio } : {}),
      footer: { text: "MercadoWoW · Crafting Sniper" },
      timestamp: new Date(ahora).toISOString(),
    }],
  };
}

/** ¿Debe llevar mención? Solo desde la clase configurada (por defecto, «excepcional») y con un rol válido. */
export function mencionPara(o, cfg) {
  const c = normalizarConfig(cfg);
  if (!c.mencion_rol || !/^\d{5,25}$/.test(String(c.mencion_rol))) return null;
  return claseDe(o.clase).rango >= claseDe(c.mencion_desde).rango ? String(c.mencion_rol) : null;
}

// ---------- plan con presupuesto ----------
/**
 * Qué fabricar con un presupuesto (cobre). Recorre las oportunidades por score y, para cada una, fabrica
 * como mucho: lo que permiten los materiales publicados, 2 días de ventas estimadas (para no saturar el
 * mercado) y lo que queda de presupuesto. Sin ventas conocidas: 1 sola fabricación.
 * @returns {{lineas: {spell, id, nombre, veces, unidades, coste, neta}[], invertido: number, neta: number, sobra: number}}
 */
export function planConPresupuesto(oportunidades, presupuesto) {
  let sobra = Math.max(0, Math.floor(presupuesto));
  const lineas = [];
  for (const o of oportunidades) {
    if (!(o.coste > 0) || sobra < o.coste) continue;
    const porVentas = o.ventas == null ? 1 : Math.max(1, Math.floor((o.ventas * 2) / o.unidades));
    const tope = Math.min(porVentas, o.maxFabricable ?? Infinity, Math.floor(sobra / o.coste));
    if (tope < 1) continue;
    lineas.push({ spell: o.spell, id: o.id, nombre: o.nombre, veces: tope, unidades: tope * o.unidades,
                  coste: tope * o.coste, neta: tope * o.neta, riesgo: o.riesgo });
    sobra -= tope * o.coste;
  }
  return { lineas, invertido: lineas.reduce((s, l) => s + l.coste, 0), neta: lineas.reduce((s, l) => s + l.neta, 0), sobra };
}
