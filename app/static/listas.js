// X6: listas propias y alertas por umbral. Sin DOM, para probarlo en Node.

import { PERFIL_POR_DEFECTO } from "./subasta.js";

/** Normaliza una banda que llega del servidor (números como texto o número). */
export function normalizarPerfil(p) {
  return { ...PERFIL_POR_DEFECTO, ...Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, k === "tipo_casa" ? v : Number(v)])) };
}

/**
 * Banda que se usa para un objeto: la de la primera de sus listas que tenga una propia; si no, la general.
 * @returns {{perfil: object, lista: string|null}}
 */
export function perfilDeLista(listas, general) {
  const l = (listas ?? []).find((x) => x.perfil);
  return l ? { perfil: normalizarPerfil(l.perfil), lista: l.nombre } : { perfil: general, lista: null };
}

/** «baja a 1p 50c o menos» / «sube a 1o o más». */
export function textoAlerta(a, formatear) {
  return a.condicion === "menor" ? `baja a ${formatear(a.umbral)} o menos` : `sube a ${formatear(a.umbral)} o más`;
}
