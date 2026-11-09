// Tabla del Mercado (V2): parámetros de la petición y minigráfico. Sin DOM, para probarlo en Node.

export const POR_PAGINA = 100;
export const TRAMO_SPARK_MS = 6 * 3600e3;

/** Texto de cada estado. Solo se usa el que tenga pruebas (lo decide el servidor). */
export const ESTADO = {
  con_ofertas: "Con ofertas",
  sin_ofertas: "Sin ofertas",   // se vio en este mercado, pero no en el último escaneo
  sin_datos: "Sin datos",       // nunca se ha visto en este mercado
};

/**
 * Filtros de la página → parámetros de /api/mercado (solo los que tienen valor).
 * Precios ya en cobre entero; un precio no válido llega como null y no se envía.
 */
export function paramsMercado(f) {
  const p = {};
  const poner = (k, v) => { if (v !== null && v !== undefined && v !== "" && v !== false) p[k] = String(v); };
  poner("q", (f.texto ?? "").trim());
  poner("categoria", f.categoria);
  poner("subcategoria", f.categoria ? f.subcategoria : "");
  poner("calidad", f.calidad);
  poner("profesion", f.profesion);
  for (const k of ["nivel_min", "nivel_max", "precio_min", "precio_max"]) {
    if (Number.isInteger(f[k]) && f[k] >= 0) poner(k, f[k]);
  }
  if (f.soloOfertas) p.solo_ofertas = "true";
  poner("orden", f.orden);
  poner("dir", f.dir);
  if (f.pagina > 1) p.pagina = String(f.pagina);
  return p;
}

/** Número de páginas (al menos 1). */
export const paginas = (total, porPagina = POR_PAGINA) => Math.max(1, Math.ceil((total || 0) / porPagina));

/**
 * Minigráfico: une solo tramos de 6 h consecutivos; si falta un tramo (sin escaneos), corta la línea.
 * @param {[number, number|null][]} puntos [ms, cobre]
 * @returns {[number, number][][]} segmentos continuos
 */
export function segmentosSpark(puntos, pasoMs = TRAMO_SPARK_MS) {
  const segs = [];
  let actual = [], previo = null;
  for (const [t, v] of puntos ?? []) {
    if (v == null) { if (actual.length) segs.push(actual); actual = []; previo = null; continue; }
    if (previo != null && t - previo > pasoMs * 1.01) { segs.push(actual); actual = []; }
    actual.push([t, v]);
    previo = t;
  }
  if (actual.length) segs.push(actual);
  return segs;
}
