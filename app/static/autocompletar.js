// Autocompletado accesible del buscador (patrón «combobox» de ARIA), sin DOM:
// esta función decide qué hace cada tecla, para poder probarla en Node.
//
// Reglas (especificación del usuario):
//  * Tab con texto y sugerencias: abre si está cerrado / resalta la primera; los
//    siguientes Tab avanzan. En la última, Tab deja salir al siguiente control.
//  * Shift+Tab recorre hacia atrás; desde la primera deja salir al control anterior.
//  * ↑ ↓ también recorren. Enter confirma la resaltada. Esc cierra sin tocar el texto
//    y, después, Tab vuelve a ser el Tab normal.
//  * Sin texto o sin sugerencias, Tab se comporta como siempre. Nunca se atrapa al usuario.
//  * El texto escrito NO cambia mientras se recorre: solo al confirmar.

/** @typedef {{abierto: boolean, activo: number, n: number, cerradoPorEsc: boolean}} Estado */

export const ESTADO_INICIAL = Object.freeze({ abierto: false, activo: -1, n: 0, cerradoPorEsc: false });

/** Al llegar sugerencias nuevas: se muestran (si hay) sin resaltar ninguna. */
export function conSugerencias(estado, n) {
  return { ...estado, n, abierto: n > 0 && !estado.cerradoPorEsc, activo: -1 };
}

/** Al escribir: se olvida el Esc anterior. */
export function alEscribir(estado) {
  return { ...estado, cerradoPorEsc: false, activo: -1 };
}

const cerrar = (e, porEsc = false) => ({ ...e, abierto: false, activo: -1, cerradoPorEsc: porEsc || e.cerradoPorEsc });

/**
 * @param {Estado} e
 * @param {{tecla: string, shift?: boolean, hayTexto: boolean}} ev
 * @returns {{estado: Estado, prevenir: boolean, accion: null | "confirmar" | "buscar"}}
 */
export function teclado(e, { tecla, shift = false, hayTexto }) {
  const normal = (estado = e) => ({ estado, prevenir: false, accion: null });
  const usar = (estado, accion = null) => ({ estado, prevenir: true, accion });

  if (tecla === "Tab") {
    if (!hayTexto || e.n === 0 || e.cerradoPorEsc) return normal(e.abierto ? cerrar(e) : e);
    if (!shift) {
      if (!e.abierto || e.activo < 0) return usar({ ...e, abierto: true, activo: 0 });
      if (e.activo < e.n - 1) return usar({ ...e, activo: e.activo + 1 });
      return normal(cerrar(e));                       // última: el foco sale al siguiente control
    }
    if (!e.abierto) return normal(e);                  // Shift+Tab con la lista cerrada: normal
    if (e.activo < 0) return usar({ ...e, activo: e.n - 1 });
    if (e.activo > 0) return usar({ ...e, activo: e.activo - 1 });
    return normal(cerrar(e));                          // primera: el foco sale al control anterior
  }
  if (tecla === "ArrowDown") {
    if (e.n === 0) return normal();
    if (!e.abierto) return usar({ ...e, abierto: true, activo: 0, cerradoPorEsc: false });
    return usar({ ...e, activo: Math.min(e.n - 1, e.activo + 1) });
  }
  if (tecla === "ArrowUp") {
    if (!e.abierto || e.n === 0) return normal();
    return usar({ ...e, activo: e.activo <= 0 ? 0 : e.activo - 1 });
  }
  if (tecla === "Enter") {
    if (e.abierto && e.activo >= 0) return usar(cerrar(e), "confirmar");
    return usar(cerrar(e), "buscar");
  }
  if (tecla === "Escape") {
    if (e.abierto) return usar(cerrar(e, true));
    return normal();
  }
  return normal();
}
