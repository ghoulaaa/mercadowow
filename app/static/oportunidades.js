// «Mejores oportunidades» (etapa 4). Sin DOM: se prueba en Node.
//
// Parte de las filas de calcularFilas() (ganancia teórica con precios del último escaneo) y les añade
// indicadores para separar lo TEÓRICO de lo PROBABLE:
//   · demanda      — ventas al día estimadas (AHledger del reino o, si no hay, TSM de toda la región);
//   · competencia  — unidades a la venta frente a las ventas al día (días para vender lo publicado);
//   · riesgo       — precio sospechoso, sin demanda, materiales sin ofertas, tiempo de espera…;
//   · materiales   — coste actual frente al coste con precios históricos.
// Todas las reglas son estimaciones propias, con sus umbrales aquí abajo y su motivo en cada fila.

export const UMBRAL = Object.freeze({
  demandaAlta: 5,          // ventas/día
  demandaMedia: 1,
  competenciaBaja: 1,      // días para vender lo publicado
  competenciaMedia: 3,
  sospechaHistorico: 3,    // venta > 3 × su histórico
  sospechaNpc: 500,        // sin histórico: venta > 500 × lo que paga el NPC…
  sospechaNpcMinimo: 10000, // …y más de 1 oro
  netaMinimaRoi: 100,      // listas de ROI y de demanda: al menos 1 plata de ganancia por unidad
  descuentoMateriales: 15, // % por debajo del coste histórico
  demandaTope: 10,         // la puntuación no premia más allá de 10 ventas/día
});

export const NIVEL_TEXTO = Object.freeze({
  alta: "Alta", media: "Media", baja: "Baja", nula: "Nula", sin_dato: "Sin datos", desconocida: "Desconocida", ninguna: "Ninguna",
  bajo: "Bajo", medio: "Medio", alto: "Alto",
});

/** Recetas que en Classic tienen tiempo de espera (no se pueden repetir seguidas). Sin verificar en Forever. */
export function tieneEspera(receta, spell) {
  return /^Transmute:/i.test(receta ?? "") || spell === 18560;   // transmutaciones y Mooncloth
}

const entero = (v) => (Number.isFinite(v) && v > 0 ? v : null);

/** Indicadores de una fila de calcularFilas(). `objetos` = datos.objetos de la API. */
export function indicadores(x, objetos = {}) {
  const o = objetos[x.id] ?? {};
  const unidades = x.a.unidadesProducidas;
  const netaUnidad = x.neta == null ? null : x.neta / unidades;

  // Demanda
  const ventas = x.ventasDia ?? x.ventasRegion;
  const regional = x.ventasDia == null && x.ventasRegion != null;
  const demanda = ventas == null ? "sin_dato" : ventas >= UMBRAL.demandaAlta ? "alta" : ventas >= UMBRAL.demandaMedia ? "media"
    : ventas > 0 ? "baja" : "nula";

  // Competencia: días que tardaría en venderse lo que ya hay publicado.
  let competencia = "desconocida", dias = null;
  if (x.ventaSinOfertas) competencia = "ninguna";
  else if (x.disponible != null && ventas > 0) {
    dias = x.disponible / ventas;
    competencia = dias <= UMBRAL.competenciaBaja ? "baja" : dias <= UMBRAL.competenciaMedia ? "media" : "alta";
  }

  // Precio de venta sospechoso (anuncio absurdo o valor de mercado sin base).
  const motivosSospecha = [];
  const h = entero(o.h), vn = entero(o.vn), venta = x.precioVenta;
  if (venta != null && h != null && venta > UMBRAL.sospechaHistorico * h) {
    motivosSospecha.push(`El precio de venta es más de ${UMBRAL.sospechaHistorico} veces su histórico`);
  }
  if (venta != null && h == null && vn != null && venta >= UMBRAL.sospechaNpcMinimo && venta > UMBRAL.sospechaNpc * vn) {
    motivosSospecha.push(`Sin histórico y el precio es más de ${UMBRAL.sospechaNpc} veces lo que paga el NPC`);
  }
  if (x.topeAplicado) motivosSospecha.push("El anuncio más barato supera el tope del valor de mercado");
  const sospechoso = motivosSospecha.length > 0;

  // Coste de los materiales frente a su coste con precios históricos (solo ingredientes directos).
  let costeHistorico = 0;
  for (const m of x.a.materiales) {
    const hm = entero(objetos[m.id]?.h);
    if (hm == null) { costeHistorico = null; break; }
    costeHistorico += m.cantidad * hm;
  }
  const descuentoMateriales = costeHistorico > 0 && x.coste != null ? (1 - x.coste / costeHistorico) * 100 : null;

  const espera = tieneEspera(x.receta, x.spell);

  // Riesgo y sus motivos.
  const altos = [], medios = [];
  if (sospechoso) altos.push("Precio de venta sospechoso");
  // 0 ventas registradas no prueba que no se venda (las fuentes estiman): se dice lo que se sabe.
  if (demanda === "nula") altos.push(regional ? "Sin ventas registradas en la región (TSM)" : "Sin ventas registradas en este reino");
  if (demanda === "sin_dato") altos.push("Sin datos de ventas");
  if (demanda === "baja") medios.push("Se vende poco (menos de 1 al día)");
  if (competencia === "alta") medios.push(`Mucha competencia (≈ ${Math.round(dias)} días para vender lo publicado)`);
  if (x.ventaSinOfertas) medios.push("Sin ofertas ahora: el precio de venta es el valor de mercado");
  if (x.materialesSinOfertas?.length) medios.push("Algún material no tiene ofertas ahora");
  if (x.a.rendimiento.min !== x.a.rendimiento.max && x.a.gananciaNetaMinima != null && x.a.gananciaNetaMinima < 0) {
    medios.push("Con el rendimiento mínimo pierde dinero");
  }
  if (espera) medios.push("Tiempo de espera entre fabricaciones (en Classic)");
  const riesgo = altos.length ? "alto" : medios.length ? "medio" : "bajo";

  // Puntuación para «Mejor equilibrio»: ganancia por unidad × demanda (con tope) × factor de riesgo.
  const factor = riesgo === "bajo" ? 1 : riesgo === "medio" ? 0.5 : 0;
  const puntuacion = netaUnidad != null && netaUnidad > 0 && ventas > 0
    ? netaUnidad * Math.min(ventas, UMBRAL.demandaTope) * factor : null;

  return {
    netaUnidad, ventas, regional, demanda, competencia, dias, sospechoso, motivosSospecha,
    costeHistorico, descuentoMateriales, espera, riesgo, motivosRiesgo: [...altos, ...medios], puntuacion,
    // Techo: ganancia si TÚ vendieras todas las ventas estimadas del día.
    techoDia: netaUnidad != null && ventas != null ? netaUnidad * ventas : null,
  };
}

const porDesc = (k) => (p, q) => (q.i[k] ?? q[k]) - (p.i[k] ?? p[k]) || p.spell - q.spell;

/**
 * Listas de «Mejores oportunidades».
 * @param {Array} filas  de calcularFilas()
 * @param {object} objetos  datos.objetos
 * @param {{profesiones?: string[], limite?: number}} [op]
 */
export function oportunidades(filas, objetos = {}, op = {}) {
  const limite = op.limite ?? 10;
  const profs = op.profesiones?.length ? new Set(op.profesiones) : null;
  const base = filas
    .filter((x) => x.completo && x.neta != null && (!profs || profs.has(x.profesion)))
    .map((x) => ({ ...x, i: indicadores(x, objetos) }));
  // Recomendables: ganan, se venden, precio creíble y riesgo no alto.
  const ok = base.filter((x) => x.neta > 0 && x.i.riesgo !== "alto");
  const top = (lista, k) => lista.slice().sort(porDesc(k)).slice(0, limite);

  return {
    equilibrio: top(ok.filter((x) => x.i.puntuacion != null), "puntuacion"),
    ganancia: top(ok, "neta"),
    roi: top(ok.filter((x) => x.i.netaUnidad >= UMBRAL.netaMinimaRoi), "roi"),
    demanda: top(ok.filter((x) => x.i.netaUnidad >= UMBRAL.netaMinimaRoi && (x.i.demanda === "alta" || x.i.demanda === "media")
      && (x.i.competencia === "baja" || x.i.competencia === "ninguna")), "techoDia"),
    materialesBaratos: top(ok.filter((x) => x.i.descuentoMateriales >= UMBRAL.descuentoMateriales), "descuentoMateriales"),
    // Pérdidas que importan: objetos que se venden (si no se venden, da igual fabricarlos o no).
    perdidas: base.filter((x) => x.neta < 0 && !x.i.sospechoso && x.i.ventas > 0)
      .sort((p, q) => p.neta - q.neta || p.spell - q.spell).slice(0, limite),
    // Ganancia teórica alta pero descartada: para revisar a mano.
    descartadas: base.filter((x) => x.neta > 0 && x.i.riesgo === "alto").sort((p, q) => q.neta - p.neta).slice(0, limite),
    resumen: {
      recetas: base.length,
      conGanancia: base.filter((x) => x.neta > 0).length,
      recomendables: ok.length,
      sospechosas: base.filter((x) => x.i.sospechoso).length,
      sinDemanda: base.filter((x) => x.neta > 0 && (x.i.demanda === "nula" || x.i.demanda === "sin_dato")).length,
    },
  };
}
