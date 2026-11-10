// X1 (plan V5): «Qué hacer con este objeto». Adaptación PROPIA de la lógica de Auctioning de TSM a
// precios agregados (no hay anuncios individuales). Sin DOM, para probarla en Node.
import { calcular } from "./rentabilidad.js";

/** Banda por defecto: preset de la comunidad de TSM (80 / 100 / 300 % del valor de mercado),
 *  con los suelos de venta al NPC que usa TSM por defecto (1,5× y 30×). */
export const PERFIL_POR_DEFECTO = {
  min_pct: 80, normal_pct: 100, max_pct: 300, npc_min_mult: 1.5, npc_max_mult: 30,
  undercut: 1, puja_pct: 100, tipo_casa: "faccion", duracion: 24,
};

const valido = (x) => Number.isFinite(x) && x > 0;
const mayor = (...xs) => { const v = xs.filter(valido); return v.length ? Math.max(...v) : null; };

/**
 * Banda de precios (en cobre entero).
 * mínimo = max(min% · mercado, npc_min × venta NPC); normal = normal% · mercado (dentro de la banda);
 * máximo = max(max% · mercado, npc_max × venta NPC). Sin valor de mercado no hay banda.
 */
export function banda(mercado, ventaNpc, perfil = PERFIL_POR_DEFECTO) {
  if (!valido(mercado)) return null;
  const npc = valido(ventaNpc) ? ventaNpc : null;
  const min = Math.round(mayor(mercado * perfil.min_pct / 100, npc != null ? npc * perfil.npc_min_mult : null));
  const max = Math.max(min, Math.round(mayor(mercado * perfil.max_pct / 100, npc != null ? npc * perfil.npc_max_mult : null)));
  const normal = Math.min(max, Math.max(min, Math.round(mercado * perfil.normal_pct / 100)));
  return { min, normal, max };
}

/**
 * Sugerencia de publicación, con la lógica de Auctioning:
 *  - sin ofertas ahora → precio normal;
 *  - compra mínima − undercut por debajo del mínimo → esperar (TSM no publica bajo el mínimo);
 *  - por encima del máximo → el máximo;
 *  - si no → compra mínima − undercut.
 * Después compara el neto (tras comisión) con venderlo al NPC.
 *
 * @param {{compraMinima: number|null, mercado: number|null, ventaNpc: number|null}} p
 * @param {object} perfil   banda y opciones (PERFIL_POR_DEFECTO)
 * @param {object|null} regla  regla de comisión/depósito (auction_fee_rules) para la casa y duración elegidas
 */
export function sugerencia(p, perfil = PERFIL_POR_DEFECTO, regla = null) {
  const b = banda(p.mercado, p.ventaNpc, perfil);
  const npc = valido(p.ventaNpc) ? p.ventaNpc : null;
  if (!b) {
    return {
      accion: npc ? "npc" : "sin_datos", accionSubasta: "sin_datos", banda: null, precio: null, puja: null,
      neto: null, comision: null, deposito: null, ventaNpc: npc, compraMinima: valido(p.compraMinima) ? p.compraMinima : null,
      motivo: "sin_mercado",
    };
  }
  let accion, precio, motivo;
  const cm = valido(p.compraMinima) ? p.compraMinima : null;
  if (cm == null) {
    accion = "publicar"; precio = b.normal; motivo = "normal";
  } else {
    const candidato = cm - perfil.undercut;
    if (candidato < b.min) { accion = "esperar"; precio = null; motivo = "bajo_minimo"; }
    else if (candidato > b.max) { accion = "publicar"; precio = b.max; motivo = "sobre_maximo"; }
    else { accion = "publicar"; precio = candidato; motivo = "undercut"; }
  }
  // Puja: un % del precio de compra inmediata, nunca por debajo del mínimo ni por encima del precio.
  const puja = precio == null ? null : Math.min(precio, Math.max(b.min, Math.round(precio * perfil.puja_pct / 100)));
  let neto = null, deposito = null, comision = null;
  if (precio != null && regla) {
    const r = calcular({ precio, modoPrecio: "unitario", cantidad: 1, porSubasta: 1, coste: null, modoCoste: "unitario",
                         ventaNpc: npc, fallidas: 0 }, regla);
    if (!r.errores.length) { neto = r.ingresoNeto; deposito = r.depositoInicial; comision = r.comision; }
  }
  // ¿Compensa más el NPC? Si el neto de la subasta no lo supera, o si toca esperar y tu mínimo no pasa de lo
  // que paga el NPC (vender ya al NPC no es peor que el mínimo que aceptarías).
  const accionSubasta = accion;
  if (npc != null && ((accion === "publicar" && neto != null && neto <= npc) || (accion === "esperar" && b.min <= npc))) {
    accion = "npc";
  }
  return { accion, accionSubasta, banda: b, precio, puja, neto, comision, deposito, ventaNpc: npc, motivo, compraMinima: cm };
}

/** Texto del motivo, en español y con las cifras. `fmt` formatea cobre (formatearMoneda). */
export function textoMotivo(s, fmt, perfil = PERFIL_POR_DEFECTO) {
  const und = perfil.undercut ? fmt(perfil.undercut) : "0c";
  switch (s.motivo) {
    case "sin_mercado": return s.ventaNpc != null
      ? `Sin valor de mercado para calcular una banda. El NPC paga ${fmt(s.ventaNpc)} por unidad.`
      : "Sin valor de mercado ni venta al NPC: no hay base para sugerir un precio.";
    case "normal": return `Nadie lo vende ahora: se sugiere el precio normal de tu banda (${fmt(s.banda.normal)}).`;
    case "undercut": return `${und} por debajo de la compra mínima actual (${fmt(s.compraMinima)}), dentro de tu banda.`;
    case "sobre_maximo": return `La compra mínima (${fmt(s.compraMinima)}) supera tu máximo: se sugiere el máximo (${fmt(s.banda.max)}).`;
    case "bajo_minimo": return `La compra mínima (${fmt(s.compraMinima)}) está por debajo de tu mínimo (${fmt(s.banda.min)}). ` +
      "Como TSM por defecto, no se publica por debajo del mínimo: espera a que suba o baja tu banda.";
    default: return s.motivo;
  }
}
