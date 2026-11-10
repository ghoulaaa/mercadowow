// Interfaz V6: lógica sin DOM (etiquetas de filtros, búsquedas recientes, actualización sin reordenar).

export const MAX_RECIENTES = 8;

/**
 * Añade una búsqueda reciente al principio, sin repetir. Una búsqueda es {texto} o un objeto {id, nombre, icono, calidad}.
 * @returns nueva lista (máx. MAX_RECIENTES)
 */
export function agregarReciente(lista, item) {
  const clave = (x) => (x.id != null ? `#${x.id}` : `t:${String(x.texto ?? "").trim().toLowerCase()}`);
  if (item.id == null && !String(item.texto ?? "").trim()) return lista ?? [];
  const k = clave(item);
  return [item, ...(lista ?? []).filter((x) => clave(x) !== k)].slice(0, MAX_RECIENTES);
}

/**
 * Etiquetas de los filtros activos, en el orden en que se leen en la barra lateral.
 * @param e estado: {texto, categoria, subcategoria, calidad, profesion, rol, materiales, familia, nivel_min, nivel_max,
 *                   precio_min, precio_max, soloOfertas, oportunidad, ventasRegion, lista}
 * @param n nombres: {categoria(c), profesion(p), rol(r), familia(f), calidad(q), oportunidad(o), lista(id), moneda(cobre)}
 * @returns {{clave: string, texto: string}[]}
 */
export function chipsFiltros(e, n) {
  const c = [];
  const pon = (clave, texto) => c.push({ clave, texto });
  if (e.texto) pon("texto", `«${e.texto}»`);
  if (e.categoria) pon("categoria", e.subcategoria ? `${n.categoria(e.categoria)} › ${e.subcategoria}` : n.categoria(e.categoria));
  if (e.profesion) pon("profesion", n.profesion(e.profesion) + (e.rol ? ` · ${n.rol(e.rol)}` : ""));
  if (e.materiales) pon("materiales", e.familia ? `Materiales · ${n.familia(e.familia)}` : "Materiales");
  if (e.calidad) pon("calidad", n.calidad(e.calidad));
  if (e.nivel_min != null || e.nivel_max != null) {
    pon("nivel", `Nivel ${e.nivel_min ?? 0}–${e.nivel_max ?? "…"}`);
  }
  if (e.precio_min != null || e.precio_max != null) {
    pon("precio", `Precio ${e.precio_min != null ? n.moneda(e.precio_min) : "0"}–${e.precio_max != null ? n.moneda(e.precio_max) : "…"}`);
  }
  if (e.soloOfertas) pon("ofertas", "Con ofertas");
  if (e.oportunidad) pon("oportunidad", n.oportunidad(e.oportunidad));
  if (e.ventasRegion) pon("region", `Región ≥ ${e.ventasRegion}/día`);
  if (e.lista) pon("lista", n.lista(e.lista));
  return c;
}

/**
 * Actualización de precios sin reordenar por sorpresa: las filas que siguen en la página se quedan en
 * su sitio con los datos nuevos; las que ya no están conservan su último dato. Dice si el orden cambió.
 * @returns {{filas: object[], cambioOrden: boolean}}
 */
export function fusionarSinReordenar(viejas, nuevas) {
  const ids = (xs) => (xs ?? []).map((x) => x.id);
  const a = ids(viejas), b = ids(nuevas);
  const cambioOrden = a.length !== b.length || a.some((id, i) => id !== b[i]);
  if (!cambioOrden) return { filas: nuevas ?? [], cambioOrden: false };
  const porId = new Map((nuevas ?? []).map((x) => [x.id, x]));
  return { filas: (viejas ?? []).map((x) => porId.get(x.id) ?? x), cambioOrden: true };
}

/** «/» enfoca el buscador solo si no se está escribiendo en otro campo. */
export function atajoBuscar(ev, activo) {
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const t = activo?.tagName;
  return !(t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || activo?.isContentEditable);
}
