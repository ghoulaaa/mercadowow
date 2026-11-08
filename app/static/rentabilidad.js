// Calculadora de rentabilidad de una venta en la casa de subastas. Sin DOM (se prueba en Node).
//
// Todo en COBRE ENTERO (1 oro = 100 platas = 10 000 cobres). Fórmulas de la especificación:
//   ingreso neto de una venta = precio de venta − comisión
//   beneficio = ingreso neto − coste de adquisición − depósitos perdidos en publicaciones anteriores
// El depósito de la publicación que SE VENDE se devuelve: no cuenta como pérdida ni se descuenta dos veces.
// Las reglas (comisión, % de depósito, mínimo, redondeo) vienen de la tabla auction_fee_rules
// y están marcadas como no verificadas hasta que se confirmen en el juego.

const REDONDEOS = { floor: Math.floor, round: Math.round, ceil: Math.ceil };

/** Reparte un total entero entre n partes con pesos enteros, sin perder ni un cobre. */
export function repartir(total, pesos) {
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (suma === 0) return pesos.map(() => 0);
  const base = pesos.map((p) => Math.floor((total * p) / suma));
  let resto = total - base.reduce((a, b) => a + b, 0);
  for (let i = 0; resto > 0; i = (i + 1) % base.length, resto--) base[i]++;
  return base;
}

/** Unidades de cada subasta: cantidad 45, 20 por subasta → [20, 20, 5]. */
export function subastas(cantidad, porSubasta) {
  const n = Math.ceil(cantidad / porSubasta);
  return Array.from({ length: n }, (_, i) => Math.min(porSubasta, cantidad - i * porSubasta));
}

function validar(e) {
  const err = [];
  const entero = (v, campo, min = 0) => {
    if (!Number.isSafeInteger(v) || v < min) err.push(`${campo} debe ser un entero ≥ ${min}`);
  };
  entero(e.precio, "El precio de venta");
  entero(e.cantidad, "La cantidad", 1);
  entero(e.porSubasta, "Las unidades por subasta", 1);
  entero(e.fallidas ?? 0, "Las publicaciones fallidas");
  for (const [v, campo] of [[e.coste, "El coste"], [e.ventaNpc, "El valor de venta al NPC"],
                            [e.depositosPerdidosReales, "Los depósitos perdidos"]]) {
    if (v != null) entero(v, campo);
  }
  if (e.cantidad > 1_000_000) err.push("La cantidad es demasiado grande");
  return err;
}

/** Ingreso neto (tras recuperar el depósito) de vender las subastas a un precio unitario dado. */
function netoConPrecioUnitario(precioUnidad, partes, regla) {
  const r = REDONDEOS[regla.redondeo] ?? Math.floor;
  return partes.reduce((s, u) => s + precioUnidad * u - r((precioUnidad * u * regla.comision_pct) / 100), 0);
}

/**
 * @param {{precio: number, modoPrecio: "unitario"|"total", cantidad: number, porSubasta: number,
 *          coste: number|null, modoCoste: "unitario"|"total", ventaNpc: number|null,
 *          fallidas?: number, depositosPerdidosReales?: number|null}} e
 * @param {{comision_pct: number, deposito_pct: number, deposito_minimo: number, redondeo?: string,
 *          duracion_horas?: number, tipo_casa?: string, verificado?: boolean}} regla
 */
export function calcular(e, regla) {
  const errores = validar(e);
  if (errores.length) return { errores };
  const r = REDONDEOS[regla.redondeo] ?? Math.floor;
  const partes = subastas(e.cantidad, e.porSubasta);
  const total = e.modoPrecio === "total" ? e.precio : e.precio * e.cantidad;
  if (!Number.isSafeInteger(total)) return { errores: ["El valor total es demasiado grande"] };

  // Precio de cada subasta (si se dio un total que no divide exacto, el resto va a las primeras).
  const precioSubasta = repartir(total, partes);
  const comisiones = precioSubasta.map((p) => r((p * regla.comision_pct) / 100));
  const depositos = partes.map((u) => Math.max(
    regla.deposito_minimo,
    e.ventaNpc == null ? 0 : r((e.ventaNpc * u * regla.deposito_pct) / 100)));

  const comision = comisiones.reduce((a, b) => a + b, 0);
  const depositoInicial = depositos.reduce((a, b) => a + b, 0);
  const ingresoNeto = total - comision;                       // el depósito vuelve: no se resta
  const recibidoPorCorreo = total - comision + depositoInicial; // lo que llega al correo al vender
  const fallidas = e.fallidas ?? 0;
  const perdidosSupuestos = e.depositosPerdidosReales == null;
  const depositosPerdidos = perdidosSupuestos ? fallidas * depositoInicial : e.depositosPerdidosReales;
  const costeTotal = e.coste == null ? null : (e.modoCoste === "total" ? e.coste : e.coste * e.cantidad);
  const beneficio = costeTotal == null ? null : ingresoNeto - costeTotal - depositosPerdidos;
  const margen = beneficio == null || !costeTotal ? null : beneficio / costeTotal;

  // Precio unitario mínimo para no perder oro (búsqueda binaria: el neto crece con el precio).
  const objetivo = (costeTotal ?? 0) + depositosPerdidos;
  let equilibrio = null;
  if (regla.comision_pct < 100) {
    let lo = 0, hi = Math.ceil(objetivo / (e.cantidad * (1 - regla.comision_pct / 100))) + 2;
    while (netoConPrecioUnitario(hi, partes, regla) < objetivo && hi < 1e15) hi *= 2;
    if (hi < 1e15) {
      while (lo < hi) {
        const m = Math.floor((lo + hi) / 2);
        if (netoConPrecioUnitario(m, partes, regla) >= objetivo) hi = m; else lo = m + 1;
      }
      equilibrio = lo;
    }
  }

  const supuestos = [];
  if (!regla.verificado) supuestos.push("Comisión y depósito sin verificar en el juego (reglas configurables).");
  if (e.ventaNpc == null) supuestos.push("Valor de venta al NPC desconocido: el depósito es solo el mínimo por subasta.");
  if (fallidas && perdidosSupuestos) supuestos.push(`Depósitos perdidos estimados: ${fallidas} publicación(es) fallida(s) con las mismas condiciones.`);
  if (costeTotal == null) supuestos.push("Sin coste de adquisición: no se calcula beneficio ni margen.");

  return {
    errores: [],
    subastas: partes.length,
    unidadesPorSubasta: partes,
    valorTotal: total,
    precioUnitarioMedio: total / e.cantidad,
    comision,
    depositoInicial,
    reembolsoDeposito: depositoInicial,
    recibidoPorCorreo,
    ingresoNeto,
    depositosPerdidos,
    depositosPerdidosEstimados: perdidosSupuestos && fallidas > 0,
    costeTotal,
    beneficio,
    margen,
    precioEquilibrioUnitario: equilibrio,
    supuestos,
  };
}
