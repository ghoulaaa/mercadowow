// Gráfico de líneas en SVG, sin librerías (la página solo ejecuta su propio código).
// Una sola escala Y (cobre), líneas de 2 px, medianas como referencia discontinua,
// leyenda + etiqueta al final de cada línea, y cruceta con tooltip al pasar el ratón.

import { formatearMoneda } from "./moneda.js";

const NS = "http://www.w3.org/2000/svg";

/** Marcas «redondas» para el eje Y (1, 2, 5 × 10^n). */
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

const el = (tag, attrs = {}, texto) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (texto !== undefined) e.textContent = texto;
  return e;
};

/**
 * @param {HTMLElement} cont
 * @param {{puntos: [number, number|null, number|null][], med7?: number, med30?: number}} datos
 */
export function dibujarGrafico(cont, datos) {
  cont.replaceChildren();
  const pts = (datos.puntos || []).filter((p) => p[1] != null || p[2] != null);
  if (pts.length < 2) {
    cont.append(Object.assign(document.createElement("p"), {
      className: "muted small", textContent: "Todavía no hay historial suficiente para dibujar un gráfico.",
    }));
    return;
  }
  const series = [
    { i: 1, nombre: "Compra mínima", clase: "serie-1" },
    { i: 2, nombre: "Valor de mercado", clase: "serie-2" },
  ].filter((s) => pts.some((p) => p[s.i] != null));

  const W = Math.max(280, cont.clientWidth || 600), H = 220;
  const m = { izq: 54, der: 96, arr: 12, aba: 26 };
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const valores = pts.flatMap((p) => series.map((s) => p[s.i])).filter((v) => v != null);
  for (const r of [datos.med7, datos.med30]) if (r != null) valores.push(r);
  const marcas = marcasEje(Math.min(...valores), Math.max(...valores));
  const yMin = Math.min(marcas[0], ...valores), yMax = Math.max(marcas[marcas.length - 1], ...valores);
  const X = (t) => m.izq + ((t - x0) / (x1 - x0 || 1)) * (W - m.izq - m.der);
  const Y = (v) => m.arr + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.arr - m.aba);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
    "aria-label": `Historial de precios: ${pts.length} observaciones` });

  // Rejilla y eje Y (recesivos).
  for (const v of marcas) {
    svg.append(el("line", { x1: m.izq, x2: W - m.der, y1: Y(v), y2: Y(v), class: "g-rejilla" }));
    svg.append(el("text", { x: m.izq - 6, y: Y(v) + 4, class: "g-eje", "text-anchor": "end" }, monedaCorta(v)));
  }
  // Eje X: 4–5 fechas.
  const nX = Math.min(5, pts.length);
  for (let k = 0; k < nX; k++) {
    const t = x0 + ((x1 - x0) * k) / (nX - 1);
    svg.append(el("text", { x: X(t), y: H - 6, class: "g-eje", "text-anchor": k === 0 ? "start" : k === nX - 1 ? "end" : "middle" },
      new Date(t).toLocaleDateString("es", { day: "numeric", month: "short" })));
  }

  // Medianas de referencia (discontinuas, en gris).
  for (const [v, etiqueta] of [[datos.med30, "mediana 30 d"], [datos.med7, "mediana 7 d"]]) {
    if (v == null) continue;
    svg.append(el("line", { x1: m.izq, x2: W - m.der, y1: Y(v), y2: Y(v), class: "g-ref" }));
    svg.append(el("text", { x: m.izq + 4, y: Y(v) - 4, class: "g-eje" }, etiqueta));
  }

  // Líneas: se cortan donde falta un dato (no se inventan tramos).
  const finales = [];
  for (const s of series) {
    let d = "", abierta = false;
    for (const p of pts) {
      if (p[s.i] == null) { abierta = false; continue; }
      d += `${abierta ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[s.i]).toFixed(1)}`;
      abierta = true;
    }
    svg.append(el("path", { d, class: `g-linea ${s.clase}` }));
    const ult = [...pts].reverse().find((p) => p[s.i] != null);
    finales.push({ s, y: Y(ult[s.i]) });
  }
  // Etiquetas directas al final de cada línea, separadas si chocan.
  finales.sort((a, b) => a.y - b.y);
  for (let k = 1; k < finales.length; k++) {
    if (finales[k].y - finales[k - 1].y < 14) finales[k].y = finales[k - 1].y + 14;
  }
  for (const f of finales) {
    svg.append(el("text", { x: W - m.der + 6, y: f.y + 4, class: "g-etiqueta" }, f.s.nombre));
  }

  // Cruceta + tooltip.
  const cruz = el("line", { y1: m.arr, y2: H - m.aba, class: "g-cruz", visibility: "hidden" });
  const puntosHover = series.map((s) => el("circle", { r: 4, class: `g-punto ${s.clase}`, visibility: "hidden" }));
  svg.append(cruz, ...puntosHover);
  const zona = el("rect", { x: m.izq, y: m.arr, width: W - m.izq - m.der, height: H - m.arr - m.aba, class: "g-zona" });
  svg.append(zona);

  const tip = document.createElement("div");
  tip.className = "g-tip";
  tip.hidden = true;

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
    tip.replaceChildren();
    const f = document.createElement("div");
    f.className = "g-tip-fecha";
    f.textContent = new Date(mejor[0]).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
    tip.append(f);
    for (const s of series) {
      const fila = document.createElement("div");
      const marca = document.createElement("span"); marca.className = `g-tip-marca ${s.clase}`;
      fila.append(marca, `${s.nombre}: ${formatearMoneda(mejor[s.i])}`);
      tip.append(fila);
    }
    tip.hidden = false;
    const izquierda = (xx / W) * caja.width;
    tip.style.left = `${Math.min(Math.max(izquierda + 12, 0), caja.width - 190)}px`;
  };
  const ocultar = () => {
    tip.hidden = true;
    cruz.setAttribute("visibility", "hidden");
    puntosHover.forEach((p) => p.setAttribute("visibility", "hidden"));
  };
  zona.addEventListener("pointermove", mostrar);
  zona.addEventListener("pointerleave", ocultar);

  // Leyenda (identidad nunca solo por color: nombre + muestra de línea).
  const leyenda = document.createElement("div");
  leyenda.className = "g-leyenda";
  for (const s of series) {
    const it = document.createElement("span");
    const mk = document.createElement("span"); mk.className = `g-tip-marca ${s.clase}`;
    it.append(mk, s.nombre);
    leyenda.append(it);
  }
  const ref = document.createElement("span");
  const mr = document.createElement("span"); mr.className = "g-tip-marca g-ref-marca";
  ref.append(mr, "Medianas propias (referencia)");
  leyenda.append(ref);

  const marco = document.createElement("div");
  marco.className = "g-marco";
  marco.append(svg, tip);
  cont.append(leyenda, marco);

  // Vista de tabla (accesibilidad): las últimas 48 observaciones.
  const det = document.createElement("details");
  const sum = document.createElement("summary"); sum.textContent = "Ver los datos como tabla";
  const tb = document.createElement("table"); tb.className = "tabla mini";
  const cab = document.createElement("tr");
  for (const t of ["Hora", ...series.map((s) => s.nombre)]) { const th = document.createElement("th"); th.textContent = t; cab.append(th); }
  tb.append(cab);
  for (const p of pts.slice(-48).reverse()) {
    const tr = document.createElement("tr");
    const c0 = document.createElement("td"); c0.textContent = new Date(p[0]).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
    tr.append(c0);
    for (const s of series) { const td = document.createElement("td"); td.className = "num"; td.textContent = formatearMoneda(p[s.i]); tr.append(td); }
    tb.append(tr);
  }
  det.append(sum, tb);
  cont.append(det);
}
