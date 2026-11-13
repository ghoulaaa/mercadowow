// Fabricación V2 (rediseño): lógica de presentación sin DOM, para probarla en Node.
// No calcula precios ni ganancias: usa las filas de calcularFilas() y los indicadores de oportunidades.js
// tal cual; aquí solo se agrupa, se resume y se prepara lo que la vista muestra.

import { indicadores, tieneEspera } from "./oportunidades.js";

// ---------- columnas de la tabla ----------
/** [clave de orden, título, ¿visible por defecto?, ayuda]. «nombre» siempre está. */
export const COLUMNAS_FAB = Object.freeze([
  ["coste", "Coste", true, "Lo que cuestan los materiales de una fabricación: cada uno al más barato entre subasta, NPC o fabricarlo"],
  ["venta", "Venta estimada", true, "Lo que se obtiene al vender lo que produce una fabricación, antes de la comisión"],
  ["neta", "Ganancia neta", true, "Venta estimada − comisión de la subasta − coste. El depósito se recupera al vender: no se resta"],
  ["roi", "Retorno", true, "Ganancia neta ÷ coste × 100"],
  ["ventas", "Ventas/día", true, "Ventas al día estimadas: del reino (AHledger) o, si no hay, de toda la región (TSM), marcado como «región»"],
  ["profesion", "Profesión", false, ""],
  ["nivel", "Nivel", false, "Habilidad de profesión requerida"],
  ["bruta", "Ganancia bruta", false, "Venta estimada − coste, sin descontar la comisión"],
  ["margen", "Margen", false, "Ganancia neta ÷ venta estimada × 100"],
  ["disponible", "A la venta", false, "Unidades del producto publicadas ahora (competencia)"],
]);
export const COLUMNAS_DEFECTO = COLUMNAS_FAB.filter((c) => c[2]).map((c) => c[0]);

/** Columnas guardadas: solo claves conocidas; si no queda ninguna, las de por defecto. */
export function normalizarColumnas(lista) {
  const validas = new Set(COLUMNAS_FAB.map((c) => c[0]));
  const l = Array.isArray(lista) ? [...new Set(lista.filter((k) => validas.has(k)))] : [];
  return l.length ? COLUMNAS_FAB.map((c) => c[0]).filter((k) => l.includes(k)) : [...COLUMNAS_DEFECTO];
}

// ---------- recetas distintas que fabrican el mismo objeto ----------
/**
 * Agrupa por objeto fabricado SIN cambiar el orden: cada grupo aparece donde aparece su mejor receta
 * (la primera de la lista ya ordenada), que es la recomendada según el criterio activo.
 * Nunca junta recetas por el nombre: solo por el ID del objeto que producen.
 * @returns {{id: number, principal: object, variantes: object[]}[]}
 */
export function agruparPorProducto(lista) {
  const grupos = new Map();
  for (const x of lista) {
    const g = grupos.get(x.id);
    if (g) g.variantes.push(x);
    else grupos.set(x.id, { id: x.id, principal: x, variantes: [x] });
  }
  return [...grupos.values()];
}

const firmaMateriales = (x) => x.a.materiales.map((m) => `${m.cantidadPorFabricacion}×${m.id}`).sort().join(",");

/**
 * Qué cambia entre las variantes de un grupo (ingredientes, rendimiento, coste, espera), por variante.
 * nombreDe(id) → nombre del objeto. Devuelve [{spell, cambios: string[]}].
 */
export function diferenciasVariantes(variantes, nombreDe = (id) => `#${id}`) {
  if (variantes.length < 2) return variantes.map((x) => ({ spell: x.spell, cambios: [] }));
  const distinto = (f) => new Set(variantes.map(f)).size > 1;
  const ing = distinto(firmaMateriales), rend = distinto((x) => `${x.a.rendimiento.min}-${x.a.rendimiento.max}`);
  const coste = distinto((x) => x.coste), espera = distinto((x) => tieneEspera(x.receta, x.spell));
  return variantes.map((x) => {
    const cambios = [];
    if (ing) cambios.push(x.a.materiales.map((m) => `${m.cantidadPorFabricacion} ${nombreDe(m.id)}`).join(", "));
    if (rend) cambios.push(x.a.rendimiento.min === x.a.rendimiento.max ? `da ${x.a.rendimiento.min}` : `da ${x.a.rendimiento.min}–${x.a.rendimiento.max}`);
    if (coste && x.coste == null) cambios.push("coste incompleto");
    if (espera && tieneEspera(x.receta, x.spell)) cambios.push("tiempo de espera (en Classic; sin verificar en Forever)");
    return { spell: x.spell, cambios };
  });
}

// ---------- filtros activos como etiquetas ----------
export const FILTROS_VACIOS = Object.freeze({
  texto: "", profesiones: [], roiMin: null, netaMin: null, nivelMin: null, nivelMax: null,
  soloCompletas: false, soloRentables: false, soloConVenta: false, soloMaterialesEnVenta: false, soloConVentas: false,
  soloFavoritas: false,
});
const CASILLAS = [
  ["soloCompletas", "Precios completos"], ["soloConVenta", "Producto con ofertas"],
  ["soloMaterialesEnVenta", "Materiales con ofertas"], ["soloConVentas", "Con datos de ventas"], ["soloFavoritas", "Favoritas"],
];

/**
 * Etiquetas de los filtros activos (para quitarlos uno a uno). «Solo rentables» y el texto tienen su propio
 * control a la vista, así que no se repiten aquí. formatear(cobre) → texto de moneda.
 * @returns {{clave: string, texto: string}[]}
 */
export function chipsFiltros(f, { nombreProf = (p) => p, formatear = (c) => `${c}c` } = {}) {
  const chips = [];
  for (const p of f.profesiones ?? []) chips.push({ clave: `prof:${p}`, texto: nombreProf(p) });
  if (f.netaMin != null) chips.push({ clave: "netaMin", texto: `Ganancia ≥ ${formatear(f.netaMin)}` });
  if (f.roiMin != null) chips.push({ clave: "roiMin", texto: `Retorno ≥ ${f.roiMin} %` });
  if (f.nivelMin != null || f.nivelMax != null) {
    chips.push({ clave: "nivel", texto: f.nivelMax == null ? `Nivel ≥ ${f.nivelMin}` : f.nivelMin == null ? `Nivel ≤ ${f.nivelMax}`
      : `Nivel ${f.nivelMin}–${f.nivelMax}` });
  }
  for (const [k, t] of CASILLAS) if (f[k]) chips.push({ clave: k, texto: t });
  return chips;
}

/** Cuántos filtros hay dentro del panel «Filtros» (lo que no se ve en la fila principal). */
export function contarFiltrosPanel(f) {
  return chipsFiltros(f).filter((c) => !c.clave.startsWith("prof:")).length;
}

/** Quita un filtro por su clave de chipsFiltros(). Devuelve un objeto nuevo. */
export function quitarFiltro(f, clave) {
  const g = { ...f, profesiones: [...(f.profesiones ?? [])] };
  if (clave.startsWith("prof:")) g.profesiones = g.profesiones.filter((p) => p !== clave.slice(5));
  else if (clave === "nivel") { g.nivelMin = null; g.nivelMax = null; }
  else if (clave in FILTROS_VACIOS) g[clave] = FILTROS_VACIOS[clave];
  return g;
}

/** Limpia todos los filtros (conserva el texto buscado: se borra con su propio botón). */
export const limpiarFiltros = (f) => ({ ...FILTROS_VACIOS, profesiones: [], texto: f.texto ?? "" });

// ---------- lo que se enseña de cada receta ----------
/**
 * Por qué una cifra es de referencia y no un precio publicado ahora. Vacío = todo son ofertas actuales.
 * @returns {string[]}
 */
export function motivosReferencia(x) {
  const m = [];
  if (x.ventaSinOfertas && x.precioVenta != null) m.push("El producto no tiene ofertas ahora: la venta usa su valor de mercado");
  if (x.topeAplicado) m.push("El anuncio más barato supera el tope del valor de mercado: la venta usa el tope");
  if (x.materialesSinOfertas?.length) m.push("Algún material no tiene ofertas ahora: se usa su valor de mercado");
  return m;
}

/** Actividad de ventas: realm (AHledger) o región (TSM, marcada). null = sin datos (no es 0). */
export function actividad(x) {
  if (x.ventasDia != null) return { valor: x.ventasDia, regional: false };
  if (x.ventasRegion != null) return { valor: x.ventasRegion, regional: true };
  return null;
}

/**
 * Casos a revisar a mano (no cambian el cálculo): precio sospechoso o retorno extremo.
 * @returns {string[]} motivos; vacío = nada raro.
 */
export function motivosRevision(x, i) {
  const m = [...(i?.motivosSospecha ?? [])];
  if (x.roi != null && x.roi > UMBRAL_ROI_EXTREMO) m.push(`Retorno de más del ${UMBRAL_ROI_EXTREMO.toLocaleString("es")} %: comprueba los precios en el juego`);
  return m;
}
export const UMBRAL_ROI_EXTREMO = 1000;

// ---------- Oportunidades: una sola lista con criterio ----------
export const CRITERIOS = Object.freeze({
  equilibrio: { titulo: "Equilibrio", ayuda: "Ganancia por unidad × ventas al día (hasta 10), a la mitad si hay algún riesgo medio. Lo más sensato para empezar." },
  ganancia: { titulo: "Mayor ganancia", ayuda: "Más oro por fabricación, entre las que tienen ventas registradas y un precio creíble." },
  roi: { titulo: "Mayor retorno", ayuda: "Más oro por cada oro invertido, con al menos 1 plata de ganancia por unidad." },
});

/** Resumen de una sola etiqueta de riesgo (bajo / medio / alto) con sus motivos. */
export function etiquetaRiesgo(i) {
  const texto = { bajo: "Riesgo bajo", medio: "Riesgo medio", alto: "Riesgo alto" }[i.riesgo] ?? "Riesgo";
  return { nivel: i.riesgo, texto, motivos: i.motivosRiesgo };
}

// ---------- lista de fabricación ----------
/** Lista guardada: [{spell, veces}], sin repetir y con veces enteras de 1 a 100.000. */
export function normalizarLista(x) {
  const items = [];
  for (const it of Array.isArray(x?.items) ? x.items : []) {
    if (!Number.isInteger(it?.spell) || it.spell <= 0 || items.some((y) => y.spell === it.spell)) continue;
    const veces = Number.isInteger(it.veces) && it.veces >= 1 ? Math.min(it.veces, 100_000) : 1;
    items.push({ spell: it.spell, veces });
  }
  const tengo = {};
  for (const [k, v] of Object.entries(x?.tengo ?? {})) {
    if (/^\d+$/.test(k) && Number.isInteger(v) && v > 0) tengo[k] = v;
  }
  return { items, tengo };
}

/** Añade una receta (o suma veces si ya está). */
export function anadirALista(lista, spell, veces = 1) {
  const items = lista.items.some((y) => y.spell === spell)
    ? lista.items.map((y) => (y.spell === spell ? { ...y, veces: Math.min(y.veces + veces, 100_000) } : y))
    : [...lista.items, { spell, veces }];
  return { ...lista, items };
}

/** Materiales que hay que conseguir: los fabricados se sustituyen por sus propios ingredientes. */
function hojas(m, acc) {
  if (m.origen === "fabricar" && m.hijos?.length) { for (const h of m.hijos) hojas(h, acc); return; }
  const prev = acc.get(m.id);
  const coste = m.costeTotal ?? (m.precioUnitario == null ? null : m.precioUnitario * m.cantidad);
  if (prev) {
    prev.necesito += m.cantidad;
    prev.costeTotal = prev.costeTotal == null || coste == null ? null : prev.costeTotal + coste;
  } else {
    acc.set(m.id, { id: m.id, nombre: m.nombre, icono: m.icono, calidad: m.calidad, necesito: m.cantidad,
                    precioUnitario: m.precioUnitario ?? m.costeUnidad ?? null, costeTotal: coste, origen: m.origen });
  }
}

/**
 * Consolida la lista de fabricación.
 * simular(spell, veces) → simularReceta(...) de esa receta (o null si ya no existe).
 * tengo: {id: unidades que ya tienes}. Las que tienes NO se cuentan como gratis para la rentabilidad:
 * el coste económico es el de todos los materiales; el «gasto pendiente» es solo lo que falta comprar.
 */
export function consolidarLista(lista, simular) {
  const acc = new Map();
  const recetas = [];
  for (const it of lista.items) {
    const r = simular(it.spell, it.veces);
    if (!r) { recetas.push({ ...it, existe: false }); continue; }
    recetas.push({ ...it, existe: true, coste: r.a.costeFabricacion, neta: r.a.gananciaNeta, unidades: r.a.unidadesProducidas,
                   completo: r.a.completo });
    for (const m of r.desglose.materiales) hojas(m, acc);
  }
  const materiales = [...acc.values()].map((m) => {
    const tengo = Math.min(lista.tengo?.[m.id] ?? 0, Math.ceil(m.necesito));
    const falta = Math.max(0, Math.ceil(m.necesito) - tengo);
    return { ...m, tengo, falta, pendiente: m.precioUnitario == null ? null : falta * m.precioUnitario };
  }).sort((a, b) => (b.costeTotal ?? -1) - (a.costeTotal ?? -1) || a.id - b.id);
  const suma = (k) => (materiales.some((m) => m[k] == null) ? null : materiales.reduce((s, m) => s + m[k], 0));
  const conRecetas = recetas.filter((r) => r.existe);
  return {
    recetas, materiales,
    costeTotal: suma("costeTotal"),
    pendiente: suma("pendiente"),
    neta: conRecetas.some((r) => r.neta == null) ? null : conRecetas.reduce((s, r) => s + r.neta, 0),
    incompletos: materiales.filter((m) => m.precioUnitario == null).map((m) => m.id),
  };
}

/** Texto para copiar los materiales («3 × Hierro»), uno por línea. */
export function textoMateriales(materiales, nombreDe = (m) => m.nombre) {
  return materiales.map((m) => `${Number.isInteger(m.cantidad ?? m.necesito) ? (m.cantidad ?? m.necesito) : (m.cantidad ?? m.necesito).toFixed(2)} × ${nombreDe(m)}`).join("\n");
}

export { indicadores };
