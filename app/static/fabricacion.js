// Motor de cálculo de fabricación. Sin DOM ni base de datos: se usa en el navegador (calculadora,
// precios simulados) y en Node (pruebas, servidor). Mismas fórmulas en todas partes.
//
// Unidad interna: COBRE ENTERO (1 oro = 100 platas = 10 000 cobres).
//
// Fórmulas (especificación del proyecto):
//   coste de fabricación = Σ cantidad × precio unitario de cada material
//   ingreso bruto        = precio unitario de venta × unidades producidas
//   ganancia bruta       = ingreso bruto − coste de fabricación
//   ganancia neta        = ingreso bruto − comisión − coste de fabricación − otros costes
//   ROI                  = ganancia neta / coste de fabricación × 100
//   margen neto          = ganancia neta / ingreso bruto × 100
//
// El depósito de publicación se informa APARTE: se recupera al vender, así que no se resta de la
// ganancia. Si quieres contar depósitos que esperas perder (subastas que caducan), van en «otros costes».
//
// Redondeos (siempre del lado prudente, para no prometer oro que no existe):
//   · unidades producidas con rendimiento variable: se usa la media (min + max) / 2;
//   · ingreso bruto: hacia abajo; coste de una unidad fabricada como intermedio: hacia arriba;
//   · comisión y depósito: según la regla (`redondeo`, por defecto hacia abajo, como el juego).

import { COBRE_POR_ORO, COBRE_POR_PLATA } from "./moneda.js";

/**
 * Profundidad máxima de cadenas de fabricación (material de material de…). Los ciclos ya se cortan
 * aparte; esto solo protege la pila ante datos absurdos. Las cadenas reales de Forever tienen ≤ 6.
 */
export const MAX_PROFUNDIDAD = 32;

/** Regla de la casa de facción a 24 h (valores iniciales sin verificar de auction_fee_rules). */
export const REGLA_POR_DEFECTO = Object.freeze({
  comision_pct: 5, deposito_pct: 60, deposito_minimo: 100, redondeo: "floor", verificado: false,
});

export const ORIGEN = Object.freeze({
  SUBASTA: "subasta", NPC: "npc", FABRICAR: "fabricar", MANUAL: "manual",
});

const REDONDEOS = { floor: Math.floor, round: Math.round, ceil: Math.ceil };

// ---------------------------------------------------------------- moneda

/** 1234567 → {signo: 1, oro: 123, plata: 45, cobre: 67}. Redondea al cobre entero. */
export function desglosarMoneda(cobre) {
  if (cobre == null || !Number.isFinite(cobre)) return null;
  const signo = cobre < 0 ? -1 : 1;
  let resto = Math.round(Math.abs(cobre));
  const oro = Math.floor(resto / COBRE_POR_ORO);
  resto -= oro * COBRE_POR_ORO;
  const plata = Math.floor(resto / COBRE_POR_PLATA);
  return { signo, oro, plata, cobre: resto - plata * COBRE_POR_PLATA };
}

// ---------------------------------------------------------------- tasas

function redondear(regla) {
  return REDONDEOS[regla?.redondeo] ?? Math.floor;
}

/** Comisión de la casa al vender por `importe` cobres. */
export function comisionVenta(importe, regla = REGLA_POR_DEFECTO) {
  if (!Number.isFinite(importe) || importe <= 0) return 0;
  return redondear(regla)((importe * regla.comision_pct) / 100);
}

/**
 * Depósito por publicar `unidades` en una subasta. Depende del valor de venta AL NPC del objeto
 * (no del precio de subasta) y de la duración elegida. Sin venta al NPC conocida: solo el mínimo.
 */
export function depositoSubasta(ventaNpc, unidades, regla = REGLA_POR_DEFECTO) {
  const minimo = regla.deposito_minimo ?? 0;
  if (ventaNpc == null || !(ventaNpc > 0)) return minimo;
  return Math.max(minimo, redondear(regla)((ventaNpc * unidades * regla.deposito_pct) / 100));
}

// ---------------------------------------------------------------- entradas

/** Rendimiento de una receta: {min, max, medio}. Lanza si es inválido. */
export function rendimiento(receta) {
  const min = receta.cantidadMin ?? 1;
  const max = receta.cantidadMax ?? min;
  if (!Number.isInteger(min) || min < 1 || !Number.isInteger(max) || max < min) {
    throw new Error(`Receta ${receta.spell}: rendimiento no válido (${min}–${max})`);
  }
  return { min, max, medio: (min + max) / 2 };
}

const esPrecio = (v) => Number.isSafeInteger(v) && v > 0;

/** Acepta Map o un objeto {id: {...}}. Devuelve un Map numérico. */
function comoMapa(precios) {
  if (precios instanceof Map) return precios;
  const m = new Map();
  for (const [k, v] of Object.entries(precios ?? {})) m.set(Number(k), v);
  return m;
}

/** Índice: id del objeto → recetas que lo producen. */
export function indexarRecetas(recetas) {
  const porResultado = new Map();
  for (const r of recetas) {
    rendimiento(r); // valida
    for (const m of r.materiales) {
      if (!Number.isInteger(m.id) || !(m.cantidad > 0)) {
        throw new Error(`Receta ${r.spell}: material no válido (${JSON.stringify(m)})`);
      }
    }
    if (!porResultado.has(r.resultadoId)) porResultado.set(r.resultadoId, []);
    porResultado.get(r.resultadoId).push(r);
  }
  return porResultado;
}

// ---------------------------------------------------------------- costes

/**
 * Resolutor de costes de adquisición. Para cada objeto elige lo más barato entre:
 *   · precio manual (si lo hay, manda siempre: es una simulación tuya);
 *   · comprarlo en subasta;
 *   · comprarlo al NPC (si se conoce el precio);
 *   · fabricarlo con la receta más barata, resolviendo sus materiales de forma recursiva.
 *
 * Los ciclos (A se fabrica con B y B con A) se cortan: dentro de una cadena, un objeto que ya se está
 * resolviendo solo puede comprarse. Un resultado se memoriza solo si no dependió de un ciclo cortado,
 * así el coste de un objeto no cambia según desde dónde se pidió.
 *
 * @param {Array<{spell:number, resultadoId:number, cantidadMin?:number, cantidadMax?:number,
 *                materiales:Array<{id:number, cantidad:number}>}>} recetas
 * @param {Map<number, {subasta?:number|null, npc?:number|null}>|Object} precios  en cobre
 * @param {{manual?: Object<number,number>|Map<number,number>, fabricarIntermedios?: boolean,
 *          profundidadMax?: number}} [opciones]
 */
export function crearResolutor(recetas, precios, opciones = {}) {
  const porResultado = recetas instanceof Map ? recetas : indexarRecetas(recetas);
  const mapaPrecios = comoMapa(precios);
  const manual = comoMapa(opciones.manual);
  const fabricarIntermedios = opciones.fabricarIntermedios ?? true;
  const profundidadMax = opciones.profundidadMax ?? MAX_PROFUNDIDAD;
  const memo = new Map();
  const enCurso = new Set();

  /** Coste de fabricar UNA tanda de la receta con los costes resueltos de sus materiales. */
  function costeReceta(receta, profundidad) {
    let total = 0;
    let ciclo = false;
    const faltan = [];
    for (const m of receta.materiales) {
      const c = resolver(m.id, profundidad + 1);
      if (c.ciclo) ciclo = true;
      if (c.coste == null) faltan.push(m.id);
      else total += m.cantidad * c.coste;
    }
    return { total: faltan.length ? null : total, faltan, ciclo };
  }

  function resolver(id, profundidad = 0) {
    if (memo.has(id)) return memo.get(id);
    const p = mapaPrecios.get(id) ?? {};
    const subasta = esPrecio(p.subasta) ? p.subasta : null;
    const npc = esPrecio(p.npc) ? p.npc : null;
    const precioManual = manual.get(id);

    if (precioManual != null) {
      if (!Number.isSafeInteger(precioManual) || precioManual < 0) {
        throw new Error(`Precio manual no válido para ${id}: ${precioManual}`);
      }
      const r = { id, coste: precioManual, origen: ORIGEN.MANUAL, subasta, npc, fabricar: null, receta: null, ciclo: false };
      memo.set(id, r);
      return r;
    }

    let fabricar = null, receta = null, ciclo = false;
    const candidatas = porResultado.get(id) ?? [];
    const puedeFabricar = (fabricarIntermedios || profundidad === 0) && candidatas.length > 0;
    // `ciclo` marca un resultado que depende de desde dónde se pidió (cadena circular cortada o
    // límite de profundidad alcanzado): no se memoriza.
    if (puedeFabricar && (enCurso.has(id) || profundidad >= profundidadMax)) {
      ciclo = true; // aquí solo se puede comprar
    } else if (puedeFabricar) {
      enCurso.add(id);
      for (const r of candidatas) {
        const c = costeReceta(r, profundidad);
        if (c.ciclo) ciclo = true;
        if (c.total == null) continue;
        const unidad = Math.ceil(c.total / rendimiento(r).medio);
        if (fabricar == null || unidad < fabricar) { fabricar = unidad; receta = r; }
      }
      enCurso.delete(id);
    }

    const alternativas = [[ORIGEN.SUBASTA, subasta], [ORIGEN.NPC, npc], [ORIGEN.FABRICAR, fabricar]]
      .filter(([, v]) => v != null);
    // Empate: se prefiere comprar (subasta, luego NPC) a fabricar, que cuesta tiempo.
    const mejor = alternativas.reduce((a, b) => (b[1] < a[1] ? b : a), alternativas[0] ?? [null, null]);
    const r = {
      id, coste: mejor[1], origen: mejor[0], subasta, npc, fabricar,
      receta: mejor[0] === ORIGEN.FABRICAR ? receta : null, recetaFabricar: receta, ciclo,
    };
    if (!ciclo) memo.set(id, r);
    return r;
  }

  return {
    /** Coste de adquirir UNA unidad del objeto (null si no hay forma conocida de conseguirlo). */
    coste: (id) => resolver(id, 1),
    /** Precios del mapa (para venta y disponibilidad). */
    precio: (id) => mapaPrecios.get(id) ?? {},
    recetasDe: (id) => porResultado.get(id) ?? [],
    /** Árbol de fabricación de un objeto: qué se compra y qué se fabrica, con cantidades. */
    arbol: (id, cantidad = 1) => arbol(id, cantidad, 0, new Set()),
  };

  function arbol(id, cantidad, profundidad, camino) {
    const c = resolver(id, 1);
    const nodo = { id, cantidad, origen: c.origen, costeUnidad: c.coste,
                   costeTotal: c.coste == null ? null : Math.ceil(cantidad * c.coste), hijos: [] };
    if (c.origen === ORIGEN.FABRICAR && c.receta && !camino.has(id) && profundidad < profundidadMax) {
      const tandas = cantidad / rendimiento(c.receta).medio;
      nodo.receta = c.receta.spell;
      nodo.tandas = tandas;
      const siguiente = new Set(camino).add(id);
      nodo.hijos = c.receta.materiales.map((m) => arbol(m.id, m.cantidad * tandas, profundidad + 1, siguiente));
    }
    return nodo;
  }
}

// ---------------------------------------------------------------- análisis de una receta

const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);

/**
 * Análisis completo de una receta.
 *
 * @param {object} receta   {spell, resultadoId, cantidadMin, cantidadMax, materiales}
 * @param {ReturnType<typeof crearResolutor>} resolutor
 * @param {{fabricaciones?: number, precioVenta?: number|null, regla?: object, otrosCostes?: number,
 *          porSubasta?: number, fabricarMateriales?: boolean}} [opciones]
 *   - fabricaciones: cuántas veces se lanza la receta (por defecto 1).
 *   - precioVenta: precio unitario del producto; si no se da, el de venta del mapa de precios
 *     (`venta`, y si no hay, `subasta`).
 *   - porSubasta: unidades del producto por subasta, para el depósito (por defecto 1).
 *   - fabricarMateriales: false = los materiales directos se compran siempre (alternativa A pura).
 */
export function analizarReceta(receta, resolutor, opciones = {}) {
  const fabricaciones = opciones.fabricaciones ?? 1;
  if (!Number.isInteger(fabricaciones) || fabricaciones < 1 || fabricaciones > 100_000) {
    throw new Error(`Número de fabricaciones no válido: ${fabricaciones}`);
  }
  const regla = opciones.regla ?? REGLA_POR_DEFECTO;
  const otrosCostes = opciones.otrosCostes ?? 0;
  if (!Number.isSafeInteger(otrosCostes) || otrosCostes < 0) throw new Error("«Otros costes» debe ser un entero ≥ 0");
  const porSubasta = opciones.porSubasta ?? 1;
  const fabricarMateriales = opciones.fabricarMateriales ?? true;
  const rend = rendimiento(receta);
  const producto = resolutor.precio(receta.resultadoId);

  // ---- materiales
  const materiales = receta.materiales.map((m) => {
    const c = resolutor.coste(m.id);
    const p = resolutor.precio(m.id);
    let precioUnitario = c.coste, origen = c.origen;
    if (!fabricarMateriales && origen === ORIGEN.FABRICAR) {
      const compras = [[ORIGEN.SUBASTA, c.subasta], [ORIGEN.NPC, c.npc]].filter(([, v]) => v != null);
      [origen, precioUnitario] = compras.reduce((a, b) => (b[1] < a[1] ? b : a), compras[0] ?? [null, null]);
    }
    const cantidad = m.cantidad * fabricaciones;
    const comprar = [c.subasta, c.npc].filter((v) => v != null);
    const mejorCompra = comprar.length ? Math.min(...comprar) : null;
    return {
      id: m.id,
      cantidadPorFabricacion: m.cantidad,
      cantidad,
      precioUnitario,
      costeTotal: precioUnitario == null ? null : cantidad * precioUnitario,
      origen,
      // Comparación A (comprar) / B (fabricar), por unidad.
      comprar: mejorCompra,
      fabricar: c.fabricar,
      ahorroFabricando: mejorCompra != null && c.fabricar != null ? mejorCompra - c.fabricar : null,
      disponible: Number.isInteger(p.disponible) ? p.disponible : null,
    };
  });
  const faltan = materiales.filter((m) => m.costeTotal == null).map((m) => m.id);
  const completo = faltan.length === 0;
  const costeFabricacion = completo ? materiales.reduce((s, m) => s + m.costeTotal, 0) : null;

  // ---- producto
  const precioVenta = opciones.precioVenta !== undefined
    ? opciones.precioVenta
    : (esPrecio(producto.venta) ? producto.venta : esPrecio(producto.subasta) ? producto.subasta : null);
  if (precioVenta != null && (!Number.isSafeInteger(precioVenta) || precioVenta < 0)) {
    throw new Error(`Precio de venta no válido: ${precioVenta}`);
  }
  const unidades = rend.medio * fabricaciones;
  const ingresoBruto = precioVenta == null ? null : Math.floor(precioVenta * unidades);
  const comision = ingresoBruto == null ? null : comisionVenta(ingresoBruto, regla);
  const numSubastas = Math.ceil(unidades / porSubasta);
  const deposito = numSubastas * depositoSubasta(producto.ventaNpc, Math.min(porSubasta, unidades), regla);

  // ---- resultados
  const hay = ingresoBruto != null && costeFabricacion != null;
  const gananciaBruta = hay ? ingresoBruto - costeFabricacion : null;
  const gananciaNeta = hay ? ingresoBruto - comision - costeFabricacion - otrosCostes : null;

  const avisos = [];
  if (!completo) avisos.push("Falta el precio de algún material: coste incompleto.");
  if (precioVenta == null) avisos.push("El producto no tiene precio de venta.");
  if (rend.min !== rend.max) avisos.push(`Rendimiento variable (${rend.min}–${rend.max}): se usa la media.`);
  if (!regla.verificado) avisos.push("Comisión y depósito sin verificar en el juego.");

  return {
    spell: receta.spell,
    resultadoId: receta.resultadoId,
    fabricaciones,
    rendimiento: rend,
    unidadesProducidas: unidades,
    unidadesMinimas: rend.min * fabricaciones,
    materiales,
    completo,
    faltan,
    costeFabricacion,
    costeUnidad: costeFabricacion == null ? null : Math.ceil(costeFabricacion / unidades),
    precioVenta,
    ingresoBruto,
    comision,
    deposito,              // se recupera al vender: NO se resta
    otrosCostes,
    gananciaBruta,
    gananciaNeta,
    roiBruto: hay ? pct(gananciaBruta, costeFabricacion) : null,
    roi: hay ? pct(gananciaNeta, costeFabricacion) : null,
    margenNeto: hay ? pct(gananciaNeta, ingresoBruto) : null,
    // Peor caso con rendimiento mínimo: útil para recetas de 1–3 unidades.
    gananciaNetaMinima: hay && precioVenta != null
      ? (() => { const b = precioVenta * rend.min * fabricaciones; return b - comisionVenta(b, regla) - costeFabricacion - otrosCostes; })()
      : null,
    precioEquilibrio: costeFabricacion == null ? null : precioEquilibrio(costeFabricacion + otrosCostes, unidades, regla),
    maxFabricable: maxFabricable(receta, materiales.map((m) => ({ ...m, cantidad: m.cantidadPorFabricacion }))),
    avisos,
  };
}

/** Precio unitario mínimo de venta para no perder oro, tras la comisión. */
export function precioEquilibrio(costeTotal, unidades, regla = REGLA_POR_DEFECTO) {
  if (!(unidades > 0) || regla.comision_pct >= 100) return null;
  const neto = (p) => { const b = Math.floor(p * unidades); return b - comisionVenta(b, regla); };
  let lo = 0, hi = Math.max(1, Math.ceil(costeTotal / unidades / (1 - regla.comision_pct / 100)) + 2);
  while (neto(hi) < costeTotal) hi *= 2;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (neto(m) >= costeTotal) hi = m; else lo = m + 1;
  }
  return lo;
}

/**
 * Cuántas veces se puede lanzar la receta con el stock publicado en subasta.
 * Solo cuentan los materiales que se compran en subasta; los del NPC son ilimitados.
 * Si un material se compra en subasta y no se conoce su cantidad publicada, devuelve null.
 * Si un material se fabrica, no limita aquí (dependería de sus propios materiales):
 * se indica con `limitadoPorIntermedios`.
 */
export function maxFabricable(receta, materiales) {
  let max = Infinity, limitante = null, desconocido = false, intermedios = false;
  for (const m of materiales) {
    if (m.origen === ORIGEN.SUBASTA) {
      if (m.disponible == null) { desconocido = true; continue; }
      const n = Math.floor(m.disponible / m.cantidad);
      if (n < max) { max = n; limitante = m.id; }
    } else if (m.origen === ORIGEN.FABRICAR) {
      intermedios = true;
    }
  }
  if (desconocido) return { veces: null, limitante: null, ilimitado: false, limitadoPorIntermedios: intermedios };
  return { veces: max === Infinity ? null : max, limitante, ilimitado: max === Infinity, limitadoPorIntermedios: intermedios };
}

/** Analiza muchas recetas a la vez con un solo resolutor (los costes compartidos se calculan una vez). */
export function analizarTodas(recetas, precios, opciones = {}) {
  const resolutor = crearResolutor(recetas, precios, opciones);
  return recetas.map((r) => analizarReceta(r, resolutor, opciones));
}
