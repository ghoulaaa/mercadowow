// Profesiones y recetas (R5): filtros, orden y comparador. Sin DOM, para probarlo en Node.

export const NOMBRE_PROFESION = {
  Alchemy: "Alquimia", Blacksmithing: "Herrería", Cooking: "Cocina", Enchanting: "Encantamiento",
  Engineering: "Ingeniería", "First Aid": "Primeros auxilios", Herbalism: "Herboristería",
  Leatherworking: "Peletería", Mining: "Minería", Skinning: "Desuello", Tailoring: "Sastrería", Fishing: "Pesca",
};

export const NOMBRE_OBTENCION = { trainer: "instructor", unknown: "desconocida" };

const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * f: {texto, soloCompletas, soloRentables, soloConVentas, nivelMin, nivelMax}
 * El texto busca en el nombre de la receta, del resultado y de los reactivos, o por ID.
 */
export function filtrarRecetas(recetas, f = {}) {
  const t = sinTildes(f.texto).trim();
  const id = /^\d{1,9}$/.test(t) ? Number(t) : null;
  return recetas.filter((r) => {
    if (f.soloCompletas && !r.completa) return false;
    if (f.soloRentables && !(r.margen > 0)) return false;
    if (f.soloConVentas && !(r.resultado?.ventas_dia > 0)) return false;
    if (f.nivelMin != null && !(r.nivel >= f.nivelMin)) return false;
    if (f.nivelMax != null && !(r.nivel <= f.nivelMax)) return false;
    if (!t) return true;
    if (id != null) return r.spell === id || r.resultado?.id === id || r.reactivos.some((x) => x.id === id);
    return sinTildes(r.nombre).includes(t) || sinTildes(r.resultado?.nombre).includes(t)
      || r.reactivos.some((x) => sinTildes(x.nombre).includes(t));
  });
}

const CLAVES = {
  margen: (r) => r.margen,
  margen_pct: (r) => r.margen_pct,
  ganancia_dia: (r) => r.ganancia_dia,
  coste: (r) => r.coste,
  neto: (r) => r.neto,
  nivel: (r) => r.nivel,
  ventas: (r) => r.resultado?.ventas_dia,
  nombre: (r) => sinTildes(r.nombre),
};

/** «margen:desc». Los valores desconocidos (null) van SIEMPRE al final, en cualquier sentido. */
export function ordenarRecetas(recetas, orden = "margen:desc") {
  const [k, dir] = orden.split(":");
  const val = CLAVES[k] ?? CLAVES.margen;
  const s = dir === "asc" ? 1 : -1;
  return [...recetas].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return sinTildes(a.nombre) < sinTildes(b.nombre) ? -1 : 1;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x < y) return -s;
    if (x > y) return s;
    return a.spell - b.spell;
  });
}

/** Peso de cada reactivo en el coste (0–1); null si el coste está incompleto. */
export function pesosReactivos(r) {
  if (!r.completa || !(r.coste > 0)) return r.reactivos.map(() => null);
  return r.reactivos.map((x) => x.coste / r.coste);
}

/** De las recetas que fabrican un objeto, la más barata con coste completo (null si ninguna lo tiene). */
export function mejorReceta(fabricacion) {
  const completas = (fabricacion ?? []).filter((r) => r.completa);
  if (!completas.length) return null;
  return completas.reduce((a, b) => (b.coste / b.resultado.rendimiento < a.coste / a.resultado.rendimiento ? b : a));
}

/** Coste de fabricar UNA unidad (la receta puede dar varias). */
export const costeUnidad = (r) => (r?.coste == null ? null : Math.round(r.coste / r.resultado.rendimiento));

export const MAX_COMPARAR = 8;

/** Añade un ID a la lista del comparador sin duplicar y sin pasar del máximo. */
export function anadirComparar(lista, id) {
  if (!Number.isInteger(id) || id <= 0) return { lista, error: "ID no válido" };
  if (lista.includes(id)) return { lista, error: "Ya está en el comparador" };
  if (lista.length >= MAX_COMPARAR) return { lista, error: `Máximo ${MAX_COMPARAR} objetos` };
  return { lista: [...lista, id], error: null };
}
