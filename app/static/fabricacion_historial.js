// Historial de una receta (etapa 5). Sin DOM: se prueba en Node.
//
// La base de datos guarda los precios de cada escaneo. Aquí se vuelve a pasar el MISMO motor de la
// tabla escaneo a escaneo (comprar, NPC o fabricar; tope de venta; comisión) para obtener la evolución
// del precio de venta, del coste de fabricación y de la ganancia neta. No se interpola nada: si en un
// escaneo falta un precio necesario, ese punto queda vacío.

import { simularReceta } from "./fabricacion_tabla.js";

/**
 * Objetos y recetas que intervienen en una receta: su producto, sus ingredientes y, de forma
 * recursiva, los ingredientes de los que se pueden fabricar. Con corte de ciclos.
 */
export function subarbolReceta(datos, spell) {
  const porResultado = new Map();
  for (const r of datos.recetas ?? []) {
    if (!porResultado.has(r.r)) porResultado.set(r.r, []);
    porResultado.get(r.r).push(r);
  }
  const raiz = (datos.recetas ?? []).find((r) => r.s === spell);
  if (!raiz) return null;
  const ids = new Set([raiz.r]);
  const recetas = new Set([raiz]);
  const pendientes = [raiz];
  while (pendientes.length) {
    const r = pendientes.pop();
    for (const [id] of r.m ?? []) {
      if (ids.has(id)) continue;
      ids.add(id);
      for (const sub of porResultado.get(id) ?? []) {
        if (!recetas.has(sub)) { recetas.add(sub); pendientes.push(sub); }
      }
    }
  }
  return { ids: [...ids].sort((a, b) => a - b), recetas: [...recetas] };
}

function resumen(valores) {
  const v = valores.filter((x) => x != null);
  if (!v.length) return { actual: null, min: null, max: null, media: null, n: 0 };
  let ultimo = null;
  for (let k = valores.length - 1; k >= 0; k--) if (valores[k] != null) { ultimo = valores[k]; break; }
  return {
    actual: ultimo,
    min: Math.min(...v),
    max: Math.max(...v),
    media: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    n: v.length,
  };
}

/**
 * @param {object} datos  respuesta de datos_fabricacion (recetas y objetos actuales)
 * @param {number} spell
 * @param {object} hist   respuesta de historial_fabricacion
 * @param {object} [opciones]  las de simularReceta (regla, valorSinOfertas, fabricarIntermedios); sin precios manuales
 * @returns {{puntos: [number, number|null, number|null, number|null, number|null][], venta, coste, neta, unidades,
 *            escaneos: number, desde: number|null}}
 *   puntos: [hora (ms), precio de venta, coste de fabricación, ganancia neta, unidades del producto a la venta]
 */
export function serieHistorial(datos, spell, hist, opciones = {}) {
  const sub = subarbolReceta(datos, spell);
  if (!sub) return null;
  // id → (hora en ms → [compra mínima, valor de mercado, unidades, ventas/día])
  const series = new Map();
  for (const [id, puntos] of Object.entries(hist.series ?? {})) {
    series.set(Number(id), new Map(puntos.map(([h, s, v, c, d]) => [Date.parse(h), [s, v, c, d]])));
  }
  const op = { ...opciones, manual: undefined, precioVenta: undefined, fabricaciones: 1 };
  const puntos = [];
  for (const h of hist.escaneos ?? []) {
    const t = Date.parse(h);
    const objetos = {};
    for (const id of sub.ids) {
      const base = datos.objetos?.[id] ?? {};
      const p = series.get(id)?.get(t);
      // Precios y unidades de ESE escaneo; lo que no cambia con el tiempo (nombre, NPC, histórico) se mantiene.
      objetos[id] = { ...base, s: p?.[0] ?? null, v: p?.[1] ?? null, c: p?.[2] ?? null, d: p?.[3] ?? null };
    }
    const r = simularReceta({ ...datos, recetas: sub.recetas, objetos }, spell, op);
    const a = r?.a;
    puntos.push([t, a?.precioVenta ?? null, a?.costeFabricacion ?? null, a?.gananciaNeta ?? null,
                 objetos[datos.recetas.find((x) => x.s === spell).r]?.c ?? null]);
  }
  return {
    puntos,
    venta: resumen(puntos.map((p) => p[1])),
    coste: resumen(puntos.map((p) => p[2])),
    neta: resumen(puntos.map((p) => p[3])),
    unidades: resumen(puntos.map((p) => p[4])),
    escaneos: puntos.length,
    desde: puntos.length ? puntos[0][0] : null,
  };
}
