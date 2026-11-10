// Lógica de la tabla de precios (sin DOM, para poder probarla en Node).

export const SIN_CATEGORIA = "Sin clasificar";

/** Variación en % entre dos precios en cobre. null si falta alguno o el anterior es 0. */
export function variacion(actual, anterior) {
  if (actual == null || anterior == null || anterior === 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

/** Añade campos calculados a cada objeto de /api/precios. */
export function prepararFilas(objetos) {
  return objetos.map((o) => {
    const precio = o.precio ?? o.valor_mercado ?? null;
    return {
      ...o,
      categoria: o.categoria || SIN_CATEGORIA,
      precio_ref: precio,
      var24: variacion(precio, o.precio_24h),
      var7: variacion(precio, o.precio_7d),
      vs_hist: variacion(precio, o.historico),
      dif30: variacion(precio, o.med30),
      texto: (o.nombre + " " + o.id).toLowerCase(),
    };
  });
}

/** Subcategorías reales de una categoría (sin vacías), ordenadas. */
export function subcategorias(filas, categoria) {
  if (!categoria) return [];
  const set = new Set(filas.filter((f) => f.categoria === categoria && f.subcategoria).map((f) => f.subcategoria));
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

/** Nombre en español de la calidad (es la escala de colores del juego, no una traducción de objetos). */
export const NOMBRE_CALIDAD = {
  POOR: "Pobre", COMMON: "Común", UNCOMMON: "Poco común", RARE: "Raro", EPIC: "Épico", LEGENDARY: "Legendario",
  ARTIFACT: "Artefacto", HEIRLOOM: "Reliquia",
};

/** Nombres de las clases de objeto como aparecen en el cliente del juego en español. Son etiquetas de la
 *  interfaz (12 clases), no traducciones de objetos: los objetos conservan su nombre inglés. */
export const NOMBRE_CATEGORIA = {
  Weapon: "Armas", Armor: "Armadura", Container: "Recipientes", Consumable: "Consumibles",
  "Trade Goods": "Objetos comerciales", Recipe: "Recetas", Quest: "Objetos de misión", Miscellaneous: "Miscelánea",
  Projectile: "Proyectiles", Quiver: "Carcajes", Reagent: "Componentes", Key: "Llaves", Gem: "Gemas",
  [SIN_CATEGORIA]: "Sin clasificar",
};

/**
 * Subcategorías oficiales (las fuentes las dan en inglés) → nombre en español del juego.
 * Solo cambia lo que se muestra: los filtros siguen usando el valor original.
 * Una subcategoría desconocida se muestra tal cual (no se inventa una traducción).
 */
export const NOMBRE_SUBCATEGORIA = {
  // Armadura
  Cloth: "Tela", Cosmetic: "Cosmético", Idol: "Ídolo", Leather: "Cuero", Libram: "Tratado", Mail: "Malla",
  Miscellaneous: "Miscelánea", Plate: "Placas", Shield: "Escudo", Totem: "Tótem",
  // Consumibles
  Bandages: "Vendas", Consumable: "Consumible", Device: "Dispositivo", Elixirs: "Elixires", Explosives: "Explosivos",
  Flasks: "Frascos", "Food & Drink": "Comida y bebida", Other: "Otros", Permanent: "Permanente", Potions: "Pociones",
  Scrolls: "Pergaminos", Temporary: "Temporal",
  // Recipientes y carcajes
  Bag: "Bolsa", "Enchanting Bag": "Bolsa de encantamiento", "Herb Bag": "Bolsa de hierbas",
  "Reagent Bag": "Bolsa de componentes", "Soul Bag": "Bolsa de almas", "Ammo Pouch": "Bolsa de munición", Quiver: "Carcaj",
  // Varios
  Key: "Llave", Holiday: "Festividad", Junk: "Chatarra", Mount: "Montura", Pet: "Mascota", Reagent: "Componente",
  Quest: "Misión", Arrow: "Flecha", Bullet: "Bala",
  // Recetas
  Alchemy: "Alquimia", Blacksmithing: "Herrería", Book: "Libro", Cooking: "Cocina", Enchanting: "Encantamiento",
  Engineering: "Ingeniería", "First Aid": "Primeros auxilios", Fishing: "Pesca", Leatherworking: "Peletería",
  Tailoring: "Sastrería",
  // Objetos comerciales
  Devices: "Dispositivos", Elemental: "Elemental", Herb: "Hierba", "Metal & Stone": "Metal y piedra", Parts: "Piezas",
  "Trade Goods": "Objetos comerciales",
  // Armas
  Axe: "Hacha", Bow: "Arco", Crossbow: "Ballesta", Dagger: "Daga", "Fishing Pole": "Caña de pescar",
  "Fist Weapon": "Arma de puño", Gun: "Arma de fuego", Mace: "Maza", Polearm: "Arma de asta", Staff: "Bastón",
  Sword: "Espada", Thrown: "Arrojadiza", Wand: "Varita",
};

export const nombreSubcategoria = (s) => (s == null ? s : NOMBRE_SUBCATEGORIA[s] ?? s);

export function categorias(filas) {
  const set = new Set(filas.map((f) => f.categoria));
  return [...set].sort((a, b) =>
    a === SIN_CATEGORIA ? 1 : b === SIN_CATEGORIA ? -1 : a.localeCompare(b, "es"));
}

/**
 * @param {object[]} filas
 * @param {{texto?: string, categoria?: string, soloFavoritos?: boolean, ocultarAusentes?: boolean}} f
 */
export function filtrar(filas, f = {}) {
  const t = (f.texto || "").trim().toLowerCase();
  const palabras = t ? t.split(/\s+/) : [];
  return filas.filter((x) =>
    (!palabras.length || palabras.every((p) => x.texto.includes(p))) &&
    (!f.categoria || x.categoria === f.categoria) &&
    (!f.subcategoria || x.subcategoria === f.subcategoria) &&
    (!f.calidad || x.calidad === f.calidad) &&
    (!f.soloFavoritos || x.favorito) &&
    (!f.recomendacion || x.rec === f.recomendacion) &&
    (f.nivelMin == null || (x.nivel_objeto != null && x.nivel_objeto >= f.nivelMin)) &&
    (f.nivelMax == null || (x.nivel_objeto != null && x.nivel_objeto <= f.nivelMax)) &&
    (f.precioMin == null || (x.precio_ref != null && x.precio_ref >= f.precioMin)) &&
    (f.precioMax == null || (x.precio_ref != null && x.precio_ref <= f.precioMax)) &&
    (!f.ocultarAusentes || !x.ausente));
}

// OBSERVACION es el código interno del motor; en la página se llama «Esperar» (desde V3).
export const NOMBRE_REC = { VENDER: "Vender", GUARDAR: "Guardar", OBSERVACION: "Esperar" };

const CLAVES = {
  nombre: (x) => x.nombre,
  precio: (x) => x.precio_ref,
  cantidad: (x) => x.cantidad,
  historico: (x) => x.historico,
  var24: (x) => x.var24,
  var7: (x) => x.var7,
  vs_hist: (x) => x.vs_hist,
  dif30: (x) => x.dif30,
  neto: (x) => x.neto,
  nivel: (x) => x.nivel_objeto,
  puntos: (x) => x.puntos,
};

/** Ordena sin mutar. Los valores vacíos (null) van SIEMPRE al final, en cualquier dirección. */
export function ordenar(filas, clave = "nombre", dir = "asc") {
  const get = CLAVES[clave] ?? CLAVES.nombre;
  const s = dir === "desc" ? -1 : 1;
  return [...filas].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (va == null && vb == null) return a.nombre.localeCompare(b.nombre, "es");
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "string" ? va.localeCompare(vb, "es") : va - vb;
    return c !== 0 ? c * s : a.nombre.localeCompare(b.nombre, "es");
  });
}

export function formatearPct(p) {
  if (p == null || !Number.isFinite(p)) return "—";
  const r = Math.round(p * 10) / 10;
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
}
