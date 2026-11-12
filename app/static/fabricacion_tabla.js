// Vista «Fabricación» sin DOM: de los datos de /api/recetas?fabricacion=1 a filas calculadas con el
// motor (fabricacion.js), más filtros, orden y exportación a CSV. Se prueba en Node.

import { REGLA_POR_DEFECTO, analizarReceta, crearResolutor } from "./fabricacion.js";

const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const entero = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

export const OPCIONES_POR_DEFECTO = Object.freeze({
  // Sin ofertas ahora: usar el valor de mercado como precio de compra (marcado). Si no, el material
  // solo puede venir del NPC o de fabricarlo, y si no, la receta queda incompleta.
  valorSinOfertas: true,
  fabricarIntermedios: true,
});

/**
 * Normaliza la respuesta de la API: recetas para el motor y mapa de precios por objeto.
 * Precio de COMPRA = compra mínima (o valor de mercado si no hay ofertas y se permite).
 * Precio de VENTA del producto = compra mínima o, sin ofertas, valor de mercado; con el tope
 * (tope_pct del valor de mercado) para que un anuncio absurdo no dispare la ganancia.
 */
export function prepararDatos(datos, opciones = {}) {
  const op = { ...OPCIONES_POR_DEFECTO, ...opciones };
  const recetas = (datos.recetas ?? []).map((r) => ({
    spell: r.s, nombre: r.n, profesion: r.p, nivel: r.l ?? null, obtencion: r.o ?? null,
    resultadoId: r.r, cantidadMin: r.mn, cantidadMax: r.mx,
    materiales: (r.m ?? []).map(([id, cantidad]) => ({ id, cantidad })),
  }));
  const tope = Number(datos.tope_pct ?? 0);
  const precios = new Map();
  for (const [k, o] of Object.entries(datos.objetos ?? {})) {
    const s = entero(o.s), v = entero(o.v);
    let venta = s ?? v;
    let topeAplicado = false;
    if (venta != null && v != null && tope > 0 && venta > Math.floor((v * tope) / 100)) {
      venta = Math.floor((v * tope) / 100);
      topeAplicado = true;
    }
    precios.set(Number(k), {
      subasta: s ?? (op.valorSinOfertas ? v : null),
      sinOfertas: s == null,
      npc: entero(o.npc),
      npcTuyo: !!o.npc_tuyo,
      venta,
      topeAplicado,
      disponible: Number.isInteger(o.c) ? o.c : null,
      ventaNpc: entero(o.vn),
      ventasDia: typeof o.d === "number" ? o.d : null,
      ventasRegion: typeof o.dg === "number" ? o.dg : null,
    });
  }
  return { recetas, precios };
}

/**
 * Calcula todas las recetas. Devuelve filas planas para la tabla, con el análisis completo en `a`.
 * @param {object} datos  respuesta de la API
 * @param {{regla?: object, valorSinOfertas?: boolean, fabricarIntermedios?: boolean, manual?: object}} [opciones]
 */
export function calcularFilas(datos, opciones = {}) {
  const op = { ...OPCIONES_POR_DEFECTO, ...opciones };
  const regla = op.regla ?? { ...REGLA_POR_DEFECTO, comision_pct: Number(datos.comision_pct ?? REGLA_POR_DEFECTO.comision_pct) };
  const { recetas, precios } = prepararDatos(datos, op);
  const resolutor = crearResolutor(recetas, precios, { fabricarIntermedios: op.fabricarIntermedios, manual: op.manual });
  const objetos = datos.objetos ?? {};
  return recetas.map((r) => {
    const a = analizarReceta(r, resolutor, { regla });
    const p = precios.get(r.resultadoId) ?? {};
    const o = objetos[r.resultadoId] ?? {};
    const sinOfertas = a.materiales.filter((m) => m.origen === "subasta" && precios.get(m.id)?.sinOfertas).map((m) => m.id);
    return {
      spell: r.spell,
      receta: r.nombre,
      profesion: r.profesion,
      nivel: r.nivel,
      id: r.resultadoId,
      nombre: o.n ?? r.nombre,
      icono: o.i ?? null,
      calidad: o.q ?? null,
      precioVenta: a.precioVenta,
      ventaSinOfertas: p.sinOfertas ?? true,
      topeAplicado: p.topeAplicado ?? false,
      coste: a.costeFabricacion,
      bruta: a.gananciaBruta,
      neta: a.gananciaNeta,
      roi: a.roi,
      margen: a.margenNeto,
      disponible: p.disponible ?? null,
      ventasDia: p.ventasDia ?? null,
      ventasRegion: p.ventasRegion ?? null,
      completo: a.completo,
      materialesSinOfertas: sinOfertas,
      a,
      /** Ingredientes con el precio usado y de dónde sale (se calcula al abrir la fila). */
      desglose: () => desglosar(a, resolutor, precios, objetos),
    };
  });
}

export const NOMBRE_ORIGEN = Object.freeze({
  subasta: "Subasta (compra mínima)",
  subasta_sin_ofertas: "Valor de mercado (sin ofertas ahora)",
  npc: "Compra al NPC",
  npc_tuyo: "Compra al NPC (precio tuyo)",
  fabricar: "Fabricado",
  manual: "Precio manual",
});

/** Clave de NOMBRE_ORIGEN para un material o nodo. */
function claveOrigen(origen, p) {
  if (origen === "subasta" && p?.sinOfertas) return "subasta_sin_ofertas";
  if (origen === "npc" && p?.npcTuyo) return "npc_tuyo";
  return origen ?? null;
}

/**
 * Desglose de una receta ya analizada: cada ingrediente con cantidad, precio unitario usado, origen,
 * coste, alternativas (comprar / fabricar) y, si se fabrica, sus propios ingredientes (árbol).
 * Los costes del árbol son los mismos que entran en el cálculo: nada se recalcula distinto.
 */
export function desglosar(a, resolutor, precios, objetos = {}) {
  const info = (id) => ({ nombre: objetos[id]?.n ?? `#${id}`, icono: objetos[id]?.i ?? null, calidad: objetos[id]?.q ?? null });
  const nodo = (n) => ({
    id: n.id, ...info(n.id), cantidad: n.cantidad, precioUnitario: n.costeUnidad, costeTotal: n.costeTotal,
    origen: claveOrigen(n.origen, precios.get(n.id)), receta: n.receta ?? null, tandas: n.tandas ?? null,
    hijos: (n.hijos ?? []).map(nodo),
  });
  return {
    materiales: a.materiales.map((m) => ({
      id: m.id, ...info(m.id),
      cantidad: m.cantidad,
      precioUnitario: m.precioUnitario,
      costeTotal: m.costeTotal,
      origen: claveOrigen(m.origen, precios.get(m.id)),
      comprar: m.comprar,
      fabricar: m.fabricar,
      ahorroFabricando: m.ahorroFabricando,
      disponible: m.disponible,
      // Si se fabrica, de qué está hecho (cantidades para ESTA receta).
      hijos: m.origen === "fabricar" ? nodo(resolutor.arbol(m.id, m.cantidad)).hijos : [],
      recetaIntermedia: m.origen === "fabricar" ? resolutor.coste(m.id).receta?.spell ?? null : null,
    })),
  };
}

/**
 * nombreAlt: (id) => nombre en español o null, para buscar también por él.
 * f: {texto, profesiones (array; vacío = todas), roiMin, netaMin, nivelMin, nivelMax,
 *     soloCompletas, soloRentables, soloConVenta (el producto tiene ofertas ahora),
 *     soloMaterialesEnVenta (ningún material sin ofertas), soloConVentas (ventas/día > 0)}
 */
export function filtrarFilas(filas, f = {}, nombreAlt = null) {
  const t = sinTildes(f.texto).trim();
  const id = /^\d{1,9}$/.test(t) ? Number(t) : null;
  const profs = f.profesiones?.length ? new Set(f.profesiones) : null;
  return filas.filter((x) => {
    if (profs && !profs.has(x.profesion)) return false;
    if (f.soloCompletas && !x.completo) return false;
    if (f.soloRentables && !(x.neta > 0)) return false;
    if (f.roiMin != null && !(x.roi != null && x.roi >= f.roiMin)) return false;
    if (f.netaMin != null && !(x.neta != null && x.neta >= f.netaMin)) return false;
    if (f.nivelMin != null && !(x.nivel != null && x.nivel >= f.nivelMin)) return false;
    if (f.nivelMax != null && !(x.nivel != null && x.nivel <= f.nivelMax)) return false;
    if (f.soloConVenta && x.ventaSinOfertas) return false;
    if (f.soloMaterialesEnVenta && x.materialesSinOfertas.length) return false;
    if (f.soloConVentas && !((x.ventasDia ?? x.ventasRegion) > 0)) return false;
    if (!t) return true;
    if (id != null) return x.id === id || x.spell === id || x.a.materiales.some((m) => m.id === id);
    // Nombre de la fuente (inglés), de la receta y, si se da, el nombre en español (nombreAlt(id)).
    return sinTildes(x.nombre).includes(t) || sinTildes(x.receta).includes(t)
      || (nombreAlt != null && sinTildes(nombreAlt(x.id)).includes(t));
  });
}

const CLAVES = {
  nombre: (x) => sinTildes(x.nombre),
  profesion: (x) => x.profesion,
  nivel: (x) => x.nivel,
  precio: (x) => x.precioVenta,
  coste: (x) => x.coste,
  bruta: (x) => x.bruta,
  neta: (x) => x.neta,
  roi: (x) => x.roi,
  margen: (x) => x.margen,
  disponible: (x) => x.disponible,
  ventas: (x) => x.ventasDia ?? x.ventasRegion,
};
export const CLAVES_ORDEN = Object.keys(CLAVES);

/** Orden por una columna. Los valores desconocidos (null) van SIEMPRE al final. */
export function ordenarFilas(filas, clave = "neta", dir = "desc") {
  const val = CLAVES[clave] ?? CLAVES.neta;
  const s = dir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return a.spell - b.spell;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x < y) return -s;
    if (x > y) return s;
    return a.spell - b.spell;
  });
}

const celdaCsv = (v) => {
  if (v == null) return "";
  const t = String(v);
  return /[",;\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};

/** CSV (separador coma, cobre entero, % con 2 decimales). `nombre` permite usar nombres en español. */
export function filasACsv(filas, nombre = (x) => x.nombre) {
  const cab = ["spell", "item_id", "objeto", "profesion", "nivel", "precio_venta_cobre", "coste_cobre",
               "ganancia_bruta_cobre", "ganancia_neta_cobre", "roi_pct", "margen_neto_pct", "disponible", "ventas_dia", "completo"];
  const pct = (v) => (v == null ? null : v.toFixed(2));
  const lineas = filas.map((x) => [x.spell, x.id, nombre(x), x.profesion, x.nivel, x.precioVenta, x.coste, x.bruta, x.neta,
                                   pct(x.roi), pct(x.margen), x.disponible, x.ventasDia ?? x.ventasRegion, x.completo]
    .map(celdaCsv).join(","));
  return [cab.join(","), ...lineas].join("\r\n") + "\r\n";
}
