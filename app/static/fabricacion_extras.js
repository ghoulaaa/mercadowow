// Etapa 6: recetas favoritas, comparador y alertas de fabricación. Sin DOM: se prueba en Node.
// Todo se guarda en ESTE navegador (localStorage); las alertas se revisan al cargar o recalcular la página.

import { indicadores } from "./oportunidades.js";

export const MAX_COMPARAR = 3;
export const MAX_ALERTAS = 50;
export const CAMPOS_ALERTA = Object.freeze({ neta: "Ganancia neta", roi: "ROI" });

/** Estado guardado: normaliza lo que venga de localStorage (puede estar vacío o roto). */
export function normalizarExtras(x) {
  const ints = (l) => (Array.isArray(l) ? [...new Set(l.filter((n) => Number.isInteger(n) && n > 0))] : []);
  const alertas = (Array.isArray(x?.alertas) ? x.alertas : []).filter((a) => validarAlerta(a) === null).slice(0, MAX_ALERTAS);
  return { favoritas: ints(x?.favoritas), comparar: ints(x?.comparar).slice(0, MAX_COMPARAR), alertas };
}

/** Añade o quita un spell de una lista. */
export function alternar(lista, spell) {
  return lista.includes(spell) ? lista.filter((s) => s !== spell) : [...lista, spell];
}

/** Añade al comparador sin duplicar ni pasar del máximo. */
export function anadirComparar(lista, spell) {
  if (lista.includes(spell)) return { lista, error: "Ya está en el comparador" };
  if (lista.length >= MAX_COMPARAR) return { lista, error: `Como mucho ${MAX_COMPARAR} recetas a la vez` };
  return { lista: [...lista, spell], error: null };
}

const METRICAS = [
  ["precioVenta", "Precio de venta", "moneda", "max"],
  ["coste", "Coste de fabricación", "moneda", "min"],
  ["neta", "Ganancia neta", "moneda", "max"],
  ["roi", "ROI", "pct", "max"],
  ["margen", "Margen neto", "pct", "max"],
  ["ventas", "Ventas/día", "num", "max"],
  ["disponible", "Unidades a la venta", "num", "min"],
  ["dias", "Días para vender lo publicado", "num", "min"],
];

/**
 * Comparación lado a lado. Devuelve las recetas (en el orden pedido; las que ya no existen se omiten)
 * y, por métrica, sus valores y qué columna es la mejor.
 */
export function compararRecetas(filas, spells, objetos = {}) {
  const recetas = spells.map((s) => filas.find((x) => x.spell === s)).filter(Boolean)
    .map((x) => ({ ...x, i: indicadores(x, objetos) }));
  const valor = (x, k) => (k === "ventas" ? x.i.ventas : k === "dias" ? x.i.dias : x[k]);
  const metricas = METRICAS.map(([clave, nombre, tipo, mejor]) => {
    const valores = recetas.map((x) => valor(x, clave) ?? null);
    const conValor = valores.filter((v) => v != null);
    const objetivo = conValor.length >= 2 ? (mejor === "max" ? Math.max(...conValor) : Math.min(...conValor)) : null;
    return { clave, nombre, tipo, valores, mejores: valores.map((v) => objetivo != null && v === objetivo) };
  });
  return { recetas, metricas };
}

/**
 * Una alerta es:
 *   {id, tipo: "receta", spell, campo: "neta"|"roi", umbral}  → esa receta llega al umbral;
 *   {id, tipo: "general", campo, umbral, profesiones?: string[]} → cualquier receta (de esas profesiones)
 *     que llegue al umbral y NO tenga riesgo alto (se vende y su precio es creíble).
 * umbral: cobre para «neta», porcentaje para «roi». Devuelve el texto del error o null.
 */
export function validarAlerta(a) {
  if (!a || typeof a !== "object") return "Alerta vacía";
  if (!["receta", "general"].includes(a.tipo)) return "Tipo de alerta desconocido";
  if (!Object.hasOwn(CAMPOS_ALERTA, a.campo)) return "Elige ganancia neta o ROI";
  if (!Number.isFinite(a.umbral)) return "Pon un umbral";
  if (a.campo === "neta" && !Number.isSafeInteger(a.umbral)) return "La ganancia debe ir en cobre entero";
  if (a.tipo === "receta" && !(Number.isInteger(a.spell) && a.spell > 0)) return "Receta no válida";
  if (a.profesiones != null && !Array.isArray(a.profesiones)) return "Profesiones no válidas";
  return null;
}

/** Nueva alerta con id. Lanza si no es válida o si ya hay una igual. */
export function crearAlerta(alertas, datos, ahora = Date.now()) {
  const a = { ...datos, id: `${ahora.toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  const err = validarAlerta(a);
  if (err) throw new Error(err);
  if (alertas.length >= MAX_ALERTAS) throw new Error(`Como mucho ${MAX_ALERTAS} alertas`);
  const igual = alertas.some((b) => b.tipo === a.tipo && b.campo === a.campo && b.umbral === a.umbral
    && (b.spell ?? null) === (a.spell ?? null) && JSON.stringify(b.profesiones ?? []) === JSON.stringify(a.profesiones ?? []));
  if (igual) throw new Error("Ya tienes esa alerta");
  return [...alertas, a];
}

/** Revisa las alertas contra las filas calculadas. Devuelve [{alerta, recetas: [fila…]}] solo de las que se cumplen. */
export function evaluarAlertas(filas, alertas, objetos = {}) {
  const cumple = (x, a) => x.completo && x[a.campo] != null && x[a.campo] >= a.umbral;
  const res = [];
  for (const a of alertas) {
    let recetas;
    if (a.tipo === "receta") recetas = filas.filter((x) => x.spell === a.spell && cumple(x, a));
    else {
      const profs = a.profesiones?.length ? new Set(a.profesiones) : null;
      recetas = filas.filter((x) => (!profs || profs.has(x.profesion)) && cumple(x, a) && x.neta > 0)
        .filter((x) => indicadores(x, objetos).riesgo !== "alto")
        .sort((p, q) => q[a.campo] - p[a.campo]).slice(0, 20);
    }
    if (recetas.length) res.push({ alerta: a, recetas });
  }
  return res;
}
