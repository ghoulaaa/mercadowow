// Gráficos de líneas en SVG, sin librerías (la página solo ejecuta su propio código).
// Reglas: una sola escala Y por gráfico (la cantidad va en un gráfico aparte), líneas
// de 2 px, medianas propias como referencia discontinua, leyenda + etiqueta al final de
// cada línea, cruceta con tooltip, y los periodos SIN escaneos se marcan y no se unen.

import { formatearMoneda } from "./moneda.js";

const NS = "http://www.w3.org/2000/svg";

/** Marcas «redondas» para el eje Y (1, 2, 2,5 y 5 × 10^n), cerca de `objetivo` marcas. */
export function marcasEje(min, max, objetivo = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { min = min * 0.9; max = max * 1.1 || 1; }
  const pot = 10 ** Math.floor(Math.log10((max - min) / objetivo));
  const generar = (paso) => {
    const marcas = [];
    for (let v = Math.ceil(min / paso) * paso; v <= max + paso * 1e-9; v += paso) marcas.push(Math.round(v));
    return [...new Set(marcas)];   // el cobre es entero: pasos < 1 repetirían marcas
  };
  // De los pasos «redondos», el que deja un número de marcas más cercano al objetivo (mínimo 3).
  let mejor = [];
  for (const k of [0.5, 1, 2, 2.5, 5, 10]) {
    const m = generar(k * pot);
    if (m.length < 3) continue;
    if (!mejor.length || Math.abs(m.length - objetivo) < Math.abs(mejor.length - objetivo)) mejor = m;
  }
  return mejor.length ? mejor : [Math.round(min), Math.round(max)];
}

/** Abreviatura para el eje: 123456 → «12,3o», 950 → «9p 50c». */
export function monedaCorta(cobre) {
  if (cobre >= 10_000) {
    const o = cobre / 10_000;
    return (o >= 100 ? Math.round(o).toLocaleString("es") : o.toLocaleString("es", { maximumFractionDigits: 1 })) + "o";
  }
  return formatearMoneda(cobre);
}

/** Paso típico entre observaciones (mediana de las diferencias), en ms. */
export function pasoTipico(tiempos) {
  const d = [];
  for (let k = 1; k < tiempos.length; k++) d.push(tiempos[k] - tiempos[k - 1]);
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/**
 * Parte una serie en tramos continuos: se corta donde falta un valor o donde entre dos
 * observaciones pasa más de 2,5 veces el paso esperado (periodo sin escaneos).
 * @returns {{tramos: [number, number][][], huecos: [number, number][]}}
 */
export function tramos(puntos, i, pasoMs) {
  const res = [], huecos = [];
  let actual = [], previo = null;
  for (const p of puntos) {
    const v = p[i];
    if (previo != null && pasoMs && p[0] - previo > 2.5 * pasoMs) {
      huecos.push([previo, p[0]]);
      if (actual.length) res.push(actual);
      actual = [];
    }
    previo = p[0];
    if (v == null) { if (actual.length) res.push(actual); actual = []; continue; }
    actual.push([p[0], v]);
  }
  if (actual.length) res.push(actual);
  return { tramos: res, huecos };
}

const el = (tag, attrs = {}, texto) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (texto !== undefined) e.textContent = texto;
  return e;
};
const html = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

function lienzo({ W, H, pts, valores, m, formatoEje, aria }) {
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const marcas = marcasEje(Math.min(...valores), Math.max(...valores));
  const yMin = Math.min(marcas[0], ...valores), yMax = Math.max(marcas[marcas.length - 1], ...valores);
  const X = (t) => m.izq + ((t - x0) / (x1 - x0 || 1)) * (W - m.izq - m.der);
  const Y = (v) => m.arr + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.arr - m.aba);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": aria });
  for (const v of marcas) {
    svg.append(el("line", { x1: m.izq, x2: W - m.der, y1: Y(v), y2: Y(v), class: "g-rejilla" }));
    svg.append(el("text", { x: m.izq - 6, y: Y(v) + 4, class: "g-eje", "text-anchor": "end" }, formatoEje(v)));
  }
  return { svg, X, Y, x0, x1 };
}

/**
 * @param {HTMLElement} cont
 * @param {{puntos: [number, number|null, number|null][], nombres?: string[], cantidad?: [number, number|null][],
 *          med7?: number, med30?: number, pasoMs?: number}} datos
 */
export function dibujarGrafico(cont, datos) {
  cont.replaceChildren();
  const nombres = datos.nombres ?? ["Compra mínima", "Valor de mercado"];
  const pts = (datos.puntos || []).filter((p) => p[1] != null || p[2] != null);
  if (pts.length < 2) {
    cont.append(html("p", "muted small", "Todavía no hay historial suficiente para dibujar un gráfico en este periodo."));
    return;
  }
  const series = [
    { i: 1, nombre: nombres[0], clase: "serie-1" },
    { i: 2, nombre: nombres[1], clase: "serie-2" },
  ].filter((s) => s.nombre && pts.some((p) => p[s.i] != null));
  const paso = datos.pasoMs ?? pasoTipico(pts.map((p) => p[0]));

  // Más alto y sin nombres al final de las líneas (la leyenda de debajo ya los dice): todo el ancho para el gráfico.
  const W = Math.max(280, cont.clientWidth || 600), H = 260;
  const m = { izq: 58, der: 12, arr: 14, aba: 30 };
  const valores = pts.flatMap((p) => series.map((s) => p[s.i])).filter((v) => v != null);
  for (const r of [datos.med7, datos.med30]) if (r != null) valores.push(r);
  const { svg, X, Y, x0, x1 } = lienzo({ W, H, pts, valores, m, formatoEje: monedaCorta,
    aria: `Historial de precios: ${pts.length} observaciones` });

  // Periodos sin escaneos: franja tenue (no se inventan precios en medio).
  const huecos = tramos(pts, series[0].i, paso).huecos;
  for (const [a, b] of huecos) {
    svg.append(el("rect", { x: X(a), y: m.arr, width: Math.max(1, X(b) - X(a)), height: H - m.arr - m.aba, class: "g-hueco" }));
  }

  // Tantas fechas como quepan sin pisarse (~80 px cada una).
  const nX = Math.max(2, Math.min(5, pts.length, Math.floor((W - m.izq - m.der) / 80)));
  const conHora = x1 - x0 < 2 * 86400e3;
  for (let k = 0; k < nX; k++) {
    const t = x0 + ((x1 - x0) * k) / (nX - 1);
    svg.append(el("text", { x: X(t), y: H - 6, class: "g-eje", "text-anchor": k === 0 ? "start" : k === nX - 1 ? "end" : "middle" },
      new Date(t).toLocaleString("es", conHora ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" })));
  }

  // Medianas de referencia: solo las líneas (7 d discontinua, 30 d punteada); nombre y valor van en la leyenda,
  // así ninguna etiqueta se monta sobre las líneas de precio.
  for (const [v, clase] of [[datos.med30, "med30"], [datos.med7, "med7"]]) {
    if (v == null) continue;
    svg.append(el("line", { x1: m.izq, x2: W - m.der, y1: Y(v), y2: Y(v), class: `g-ref ${clase}` }));
  }

  const finales = [];
  for (const s of series) {
    let d = "";
    for (const tr of tramos(pts, s.i, paso).tramos) {
      tr.forEach(([t, v], k) => { d += `${k ? "L" : "M"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`; });
      if (tr.length === 1) d += `h0.1`;   // punto aislado: visible
    }
    svg.append(el("path", { d, class: `g-linea ${s.clase}` }));
    const ult = [...pts].reverse().find((p) => p[s.i] != null);
    finales.push({ s, y: Y(ult[s.i]) });
  }
  finales.sort((a, b) => a.y - b.y);
  for (let k = 1; k < finales.length; k++) if (finales[k].y - finales[k - 1].y < 14) finales[k].y = finales[k - 1].y + 14;
  void finales;   // los nombres de las series van en la leyenda (antes, al final de cada línea)

  const cruz = el("line", { y1: m.arr, y2: H - m.aba, class: "g-cruz", visibility: "hidden" });
  const puntosHover = series.map((s) => el("circle", { r: 4, class: `g-punto ${s.clase}`, visibility: "hidden" }));
  svg.append(cruz, ...puntosHover);
  const zona = el("rect", { x: m.izq, y: m.arr, width: W - m.izq - m.der, height: H - m.arr - m.aba, class: "g-zona" });
  svg.append(zona);

  const tip = html("div", "g-tip");
  tip.hidden = true;
  const cantidadEn = new Map((datos.cantidad || []).map(([t, q]) => [t, q]));
  const mostrar = (ev) => {
    const caja = svg.getBoundingClientRect();
    const xSvg = ((ev.clientX - caja.left) / caja.width) * W;
    const t = x0 + ((xSvg - m.izq) / (W - m.izq - m.der)) * (x1 - x0);
    let mejor = pts[0];
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(mejor[0] - t)) mejor = p;
    const xx = X(mejor[0]);
    cruz.setAttribute("x1", xx); cruz.setAttribute("x2", xx); cruz.setAttribute("visibility", "visible");
    series.forEach((s, k) => {
      const v = mejor[s.i];
      puntosHover[k].setAttribute("visibility", v == null ? "hidden" : "visible");
      if (v != null) { puntosHover[k].setAttribute("cx", xx); puntosHover[k].setAttribute("cy", Y(v)); }
    });
    tip.replaceChildren(html("div", "g-tip-fecha", new Date(mejor[0]).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })));
    for (const s of series) {
      const fila = html("div");
      fila.append(html("span", `g-tip-marca ${s.clase}`), `${s.nombre}: ${formatearMoneda(mejor[s.i])}`);
      tip.append(fila);
    }
    if (cantidadEn.has(mejor[0])) tip.append(html("div", "", `Unidades publicadas: ${cantidadEn.get(mejor[0])?.toLocaleString("es") ?? "—"}`));
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max((xx / W) * caja.width + 12, 0), caja.width - 200)}px`;
  };
  const ocultar = () => {
    tip.hidden = true;
    cruz.setAttribute("visibility", "hidden");
    puntosHover.forEach((p) => p.setAttribute("visibility", "hidden"));
  };
  zona.addEventListener("pointermove", mostrar);
  zona.addEventListener("pointerleave", ocultar);

  const leyenda = html("div", "g-leyenda");
  for (const s of series) {
    const it = html("span");
    it.append(html("span", `g-tip-marca ${s.clase}`), s.nombre);
    leyenda.append(it);
  }
  for (const [v, clase, nombre] of [[datos.med7, "med7", "Mediana 7 d"], [datos.med30, "med30", "Mediana 30 d"]]) {
    if (v == null) continue;
    const ref = html("span");
    ref.append(html("span", `g-tip-marca g-ref-marca ${clase}`), `${nombre}: ${monedaCorta(v)}`);
    leyenda.append(ref);
  }
  if (huecos.length) {
    const h = html("span");
    h.append(html("span", "g-tip-marca g-hueco-marca"), `Sin escaneos (${huecos.length})`);
    leyenda.append(h);
  }
  const marco = html("div", "g-marco");
  marco.append(svg, tip);
  cont.append(leyenda, marco);

  // Cantidad publicada: gráfico aparte (otra unidad → otra escala, nunca doble eje).
  const cant = (datos.cantidad || []).filter(([, q]) => q != null);
  if (cant.length >= 2) {
    const Hq = 100, mq = { izq: 58, der: 12, arr: 8, aba: 8 };   // mismos márgenes que el de precios
    const c = lienzo({ W, H: Hq, pts: cant, valores: cant.map(([, q]) => q), m: mq,
      formatoEje: (v) => v.toLocaleString("es", { notation: "compact" }), aria: "Unidades publicadas" });
    let d = "";
    for (const tr of tramos(cant, 1, paso).tramos) tr.forEach(([t, q], k) => { d += `${k ? "L" : "M"}${c.X(t).toFixed(1)},${c.Y(q).toFixed(1)}`; });
    c.svg.append(el("path", { d, class: "g-linea g-cantidad" }));
    // El subtítulo de debajo ya dice qué es: sin etiqueta dentro del gráfico.
    const t = html("div", "g-subtitulo muted small", "Unidades publicadas en cada escaneo");
    cont.append(t, c.svg);
  }

  // Vista de tabla (accesibilidad): las últimas 48 observaciones.
  const det = html("details");
  det.append(html("summary", "", "Ver los datos como tabla"));
  const tb = html("table", "tabla mini");
  const cab = html("tr");
  for (const t of ["Hora", ...series.map((s) => s.nombre), ...(cant.length ? ["Unidades"] : [])]) cab.append(html("th", "", t));
  tb.append(cab);
  for (const p of pts.slice(-48).reverse()) {
    const tr = html("tr");
    tr.append(html("td", "", new Date(p[0]).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })));
    for (const s of series) tr.append(html("td", "num", formatearMoneda(p[s.i])));
    if (cant.length) tr.append(html("td", "num", cantidadEn.get(p[0])?.toLocaleString("es") ?? "—"));
    tb.append(tr);
  }
  det.append(tb);
  cont.append(det);
}
