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
  poner("rol", f.profesion ? f.rol : "");          // el rol solo tiene sentido con una profesión
  if (f.materiales) p.materiales = "true";
  poner("familia", f.materiales ? f.familia : ""); // la familia filtra dentro de los materiales
  for (const k of ["nivel_min", "nivel_max", "precio_min", "precio_max"]) {
    if (Number.isInteger(f[k]) && f[k] >= 0) poner(k, f[k]);
  }
  if (f.soloOfertas) p.solo_ofertas = "true";
  poner("orden", f.orden);
  poner("dir", f.dir);
  if (f.pagina > 1) p.pagina = String(f.pagina);
  return p;
}

/** Familias de materiales (de la clase/subclase oficial del objeto; las calcula el servidor). */
export const NOMBRE_FAMILIA = {
  hierbas: "Hierbas", metales: "Metales y piedras", telas: "Telas", cueros: "Cueros",
  encantamiento: "Encantamiento", elementales: "Elementales", cocina: "Cocina", piezas: "Piezas y componentes",
  consumibles: "Consumibles", reactivos: "Reactivos", comercio_otros: "Otros materiales", mision: "De misión", otros: "Otros",
};

/** Rol de un objeto dentro de una profesión. */
export const NOMBRE_ROL = { material: "Materiales", receta: "Recetas", producto: "Productos" };

export const MAX_IDS = 5000;

/**
 * IDs de objeto a importar desde un texto: un CSV con columna itemId / item_id / id, una lista
 * separada por comas, espacios o saltos de línea, o enlaces de Wowhead («…/item=2589»).
 * Lo que no es un ID se devuelve como error (con su línea); los repetidos se cuentan una vez.
 * @returns {{ids: number[], errores: string[]}}
 */
export function leerIds(texto) {
  const lineas = String(texto ?? "").replace(/^﻿/, "").split(/\r?\n/);
  const errores = [];
  const ids = new Set();
  const valido = (s) => /^\d{1,9}$/.test(s) && Number(s) > 0;
  // CSV con cabecera: se usa solo la columna del ID.
  const cab = lineas[0]?.split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase()) ?? [];
  const col = cab.findIndex((c) => ["itemid", "item_id", "id"].includes(c));
  if (col >= 0 && cab.length > 1) {
    lineas.slice(1).forEach((l, k) => {
      if (!l.trim()) return;
      const v = (l.split(/[;,\t]/)[col] ?? "").trim().replace(/^"|"$/g, "");
      if (valido(v)) ids.add(Number(v)); else errores.push(`Línea ${k + 2}: «${v || l.trim()}» no es un ID`);
    });
    return { ids: [...ids], errores };
  }
  lineas.forEach((l, k) => {
    for (const trozo of l.split(/[\s,;]+/).filter(Boolean)) {
      const enlace = trozo.match(/item=(\d{1,9})/);
      const v = enlace ? enlace[1] : trozo.replace(/^#/, "");
      if (valido(v)) ids.add(Number(v)); else errores.push(`Línea ${k + 1}: «${trozo}» no es un ID`);
    }
  });
  return { ids: [...ids], errores };
}

/**
 * Objeto sin ficha en ninguna fuente: la base de datos lo guarda con su ID por nombre («#216483»)
 * porque la fuente solo da un nombre provisional. Nunca se le inventa un nombre.
 */
export const sinFicha = (nombre) => /^#\d{1,9}$/.test(String(nombre ?? ""));
export const TEXTO_SIN_FICHA = "Sin ficha en la fuente";

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
