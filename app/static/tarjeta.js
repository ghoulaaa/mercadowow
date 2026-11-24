// Tarjeta gráfica del Crafting Sniper (SVG). Sin DOM ni red: el MISMO código dibuja la vista previa de la
// página (SVG en línea) y la imagen que llega a Discord (la Edge Function convierte este SVG en PNG con resvg).
// Todo sale de los datos reales de la oportunidad; lo que falta se dice («Sin datos», «Historial
// insuficiente»), nunca se inventa. Las cifras en cobre (enteros) y con el formato de monedas de WoW.

import { APARIENCIA_DEFECTO, ICONO_RESPALDO, claseDe, fabricacionRecomendada, normalizarApariencia, nombreProfesion } from "./sniper.js";

export const ANCHO_BASE = 1200;            // unidades del dibujo; el PNG se escala al ancho elegido
export const FUENTE = "Inter";

const TEMAS = {
  oscuro: { fondo: "#13151D", fondo2: "#1B1E29", tarjeta: "#20232E", borde: "#353947", texto: "#F1F5F9", sec: "#94A3B8",
            verde: "#4ADE80", rojo: "#EF4444", oro: "#FFD166", enlace: "#38BDF8", plata: "#CBD5E1", cobre: "#E0965A", pista: "#2A2E3B" },
  negro: { fondo: "#0B0C10", fondo2: "#12141A", tarjeta: "#171A22", borde: "#2A2E39", texto: "#F8FAFC", sec: "#9AA6B8",
           verde: "#4ADE80", rojo: "#EF4444", oro: "#FFD166", enlace: "#38BDF8", plata: "#CBD5E1", cobre: "#E0965A", pista: "#1F232D" },
};
export const CALIDADES = {
  POOR: ["Pobre", "#9D9D9D"], COMMON: ["Común", "#FFFFFF"], UNCOMMON: ["Poco común", "#1EFF00"], RARE: ["Raro", "#0070DD"],
  EPIC: ["Épico", "#A335EE"], LEGENDARY: ["Legendario", "#FF8000"],
};
const RIESGOS = { bajo: ["Bajo", "verde"], medio: ["Medio", "#FACC15"], alto: ["Alto", "rojo"], desconocido: ["Sin datos", "sec"] };

// ---------- utilidades ----------
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (v) => Math.round(v * 10) / 10;

/** Ancho aproximado de un texto en Inter (para recortar y ajustar tamaños; el dibujo final lo hace la fuente). */
export function anchoTexto(t, tam, peso = 400) {
  let u = 0;
  for (const ch of String(t)) {
    u += /[il.,:;'!|ı]/.test(ch) ? 0.27 : /[ fjrt()\-[\]]/.test(ch) ? 0.34 : /[0-9]/.test(ch) ? 0.6
      : /[mwMW]/.test(ch) ? 0.86 : /[A-ZÁÉÍÓÚÑ]/.test(ch) ? 0.68 : /[%]/.test(ch) ? 0.82 : 0.56;
  }
  return u * tam * (peso >= 700 ? 1.07 : peso >= 600 ? 1.04 : 1);
}
export function recortar(t, tam, peso, max) {
  t = String(t);
  if (anchoTexto(t, tam, peso) <= max) return t;
  while (t.length > 1 && anchoTexto(t + "…", tam, peso) > max) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}
/** Tamaño de letra para que un texto quepa en `max` (sin bajar de `min`). */
const ajustar = (t, tam, peso, max, min = 14) => Math.max(min, Math.min(tam, Math.floor(tam * max / Math.max(1, anchoTexto(t, tam, peso)))));

/** Cobre → partes [{n: "4", u: "g"}, …]. Sin decimales; plata y cobre a dos cifras tras una unidad mayor. */
export function partesMoneda(cobre, ap = APARIENCIA_DEFECTO) {
  if (cobre == null || !Number.isFinite(cobre)) return null;
  const letras = ap.monedas === "opc" ? ["o", "p", "c"] : ["g", "s", "c"];
  let resto = Math.round(Math.abs(cobre));
  const oro = Math.floor(resto / 10000); resto -= oro * 10000;
  const plata = Math.floor(resto / 100), cob = resto - plata * 100;
  const p = [];
  if (oro) p.push({ n: oro.toLocaleString("es"), u: letras[0], k: "oro" });
  if (plata) p.push({ n: p.length ? String(plata).padStart(2, "0") : String(plata), u: letras[1], k: "plata" });
  if (cob || !p.length) p.push({ n: p.length ? String(cob).padStart(2, "0") : String(cob), u: letras[2], k: "cobre" });
  return { signo: cobre < 0 ? "−" : "", p };
}
const textoMoneda = (cobre, ap) => { const m = partesMoneda(cobre, ap); return m ? m.signo + m.p.map((x) => x.n + x.u).join(" ") : "Sin datos"; };

const pct = (v) => (v == null || !Number.isFinite(v) ? "Sin datos" : `${v.toLocaleString("es", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })} %`);

// ---------- piezas SVG ----------
function texto(x, y, t, { tam = 18, peso = 400, color, ancla = "start", esp = 0, op = 1 } = {}) {
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${FUENTE}" font-size="${tam}" font-weight="${peso}" fill="${color}"`
    + `${ancla !== "start" ? ` text-anchor="${ancla}"` : ""}${esp ? ` letter-spacing="${esp}"` : ""}${op < 1 ? ` opacity="${op}"` : ""}>${esc(t)}</text>`;
}
/** Importe con la cifra en un color y la letra de la moneda en el suyo. `signo`: «+» para ganancias. */
function moneda(x, y, cobre, { tam, peso = 700, color, ancla = "start", signo = "", ap, T }) {
  const m = partesMoneda(cobre, ap);
  if (!m) return texto(x, y, "Sin datos", { tam: Math.round(tam * 0.7), peso: 500, color: T.sec, ancla });
  const col = { oro: T.oro, plata: T.plata, cobre: T.cobre };
  const spans = m.p.map((q, i) => `<tspan fill="${color}">${i ? " " : ""}${esc(q.n)}</tspan><tspan fill="${col[q.k]}">${q.u}</tspan>`).join("");
  const pre = m.signo || signo ? `<tspan fill="${color}">${m.signo || signo}</tspan>` : "";
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${FUENTE}" font-size="${tam}" font-weight="${peso}"${ancla !== "start" ? ` text-anchor="${ancla}"` : ""}>${pre}${spans}</text>`;
}
const anchoMoneda = (cobre, tam, peso, ap) => anchoTexto(textoMoneda(cobre, ap), tam, peso);
const rect = (x, y, w, h, { rx = 0, fill = "none", stroke = null, sw = 1, op = 1 } = {}) =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(Math.max(0, h))}" rx="${rx}" fill="${fill}"`
  + `${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}${op < 1 ? ` opacity="${op}"` : ""}/>`;
const linea = (x1, y1, x2, y2, color, sw = 1) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${color}" stroke-width="${sw}"/>`;

/** Barra de progreso: `fr` (0–1) de `ancho`; extremos redondeados. */
function barra(x, y, w, h, fr, color, T) {
  const f = Math.max(0, Math.min(1, fr));
  return rect(x, y, w, h, { rx: h / 2, fill: T.pista }) + (f > 0 ? rect(x, y, Math.max(h, w * f), h, { rx: h / 2, fill: color }) : "");
}

// Iconos vectoriales sencillos (decorativos; los objetos usan siempre su icono real).
const G = {
  monedas: (cx, cy, T) => [10, 0, -10].map((d, i) => `<ellipse cx="${cx}" cy="${cy + d}" rx="17" ry="7" fill="${i === 2 ? T.oro : "#C9962E"}" stroke="#7A5A16" stroke-width="1.5"/>`).join(""),
  martillo: (cx, cy, T) => `<g transform="rotate(-40 ${cx} ${cy})"><rect x="${cx - 3}" y="${cy - 4}" width="6" height="26" rx="2" fill="#B07A3A"/><rect x="${cx - 14}" y="${cy - 16}" width="28" height="14" rx="3" fill="${T.oro}" stroke="#7A5A16" stroke-width="1.5"/></g>`,
  grafica: (x, y, c) => [[0, 12, 10], [9, 6, 16], [18, 0, 22]].map(([dx, dy, h]) => `<rect x="${x + dx}" y="${y + dy}" width="6" height="${h}" rx="1.5" fill="${c}"/>`).join(""),
  diamante: (x, y, c) => `<polygon points="${x + 16},${y} ${x + 32},${y + 12} ${x + 16},${y + 34} ${x},${y + 12}" fill="${c}"/><polygon points="${x + 16},${y} ${x + 32},${y + 12} ${x},${y + 12}" fill="#FFFFFF" opacity=".25"/>`,
  diana: (cx, cy, c) => `<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="${c}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="4" fill="${c}"/>`,
  escudo: (x, y, c) => `<path d="M${x + 11} ${y} L${x + 22} ${y + 4} L${x + 22} ${y + 13} C${x + 22} ${y + 20} ${x + 16} ${y + 24} ${x + 11} ${y + 26} C${x + 6} ${y + 24} ${x} ${y + 20} ${x} ${y + 13} L${x} ${y + 4} Z" fill="${c}"/>`,
  cajas: (x, y, c) => `<rect x="${x}" y="${y + 11}" width="11" height="11" rx="2" fill="${c}"/><rect x="${x + 13}" y="${y + 11}" width="11" height="11" rx="2" fill="${c}"/><rect x="${x + 6}" y="${y}" width="11" height="11" rx="2" fill="${c}" opacity=".8"/>`,
  pergamino: (x, y, c) => `<rect x="${x}" y="${y}" width="22" height="26" rx="3" fill="${c}"/>${[7, 12, 17].map((d) => `<rect x="${x + 5}" y="${y + d}" width="12" height="2" fill="#5B4A2A"/>`).join("")}`,
  torre: (x, y, c) => `<path d="M${x} ${y + 26} V${y + 8} h4 v-4 h4 v4 h4 v-8 h4 v8 h4 v-4 h4 v4 h2 V${y + 26} Z" fill="${c}"/>`,
  tendencia: (x, y, c) => `<polyline points="${x},${y + 20} ${x + 8},${y + 12} ${x + 14},${y + 16} ${x + 24},${y + 4}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
};

/** URLs de iconos que necesita la tarjeta (el servidor las descarga y las incrusta). */
export function iconosDe(o, apariencia = null) {
  const ap = normalizarApariencia(apariencia);
  const u = [o.icono ?? ICONO_RESPALDO];
  if (ap.materiales) for (const m of o.materiales ?? []) u.push(m.icono ?? ICONO_RESPALDO);
  return [...new Set(u)].filter((x) => /^https:\/\/render\.worldofwarcraft\.com\//.test(x));
}

/** Tendencia de una serie [[ms, cobre], …]: variación, mínimo, máximo y color. null si hay menos de 3 puntos. */
export function tendencia(serie) {
  const s = (serie ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0);
  if (s.length < 3) return null;
  const primero = s[0][1], ultimo = s[s.length - 1][1];
  const vals = s.map((p) => p[1]);
  const variacion = ((ultimo - primero) / primero) * 100;
  return { puntos: s, variacion, min: Math.min(...vals), max: Math.max(...vals), primero, ultimo,
           sentido: variacion > 2 ? "sube" : variacion < -2 ? "baja" : "estable" };
}

const PERIODOS = { 24: "24 horas", 168: "7 días", 336: "14 días", 720: "30 días" };

/**
 * Dibuja la tarjeta. `o`: oportunidad (evaluarFila / resumen del análisis). Opciones: apariencia, mercado
 * (nombre), proveedor («tsm»/«ahledger»), serie (historial real de la compra mínima), ahora (ms), manual,
 * sitio, iconos ({url: href}: en el servidor, el icono incrustado en base64).
 * @returns {{svg: string, ancho: number, alto: number}}  ancho/alto en unidades del dibujo (ANCHO_BASE).
 */
export function tarjetaSVG(o, { apariencia = null, mercado = "", proveedor = "tsm", serie = null, ahora = Date.now(), manual = false,
                                 sitio = "", iconos = {} } = {}) {
  const ap = normalizarApariencia(apariencia);
  const T = TEMAS[ap.tema] ?? TEMAS.oscuro;
  const clase = claseDe(o.clase);
  const cc = /^#[0-9A-Fa-f]{6}$/.test(ap.colores?.[clase.clave] ?? "") ? ap.colores[clase.clave] : `#${clase.color.toString(16).padStart(6, "0")}`;
  const detallado = ap.modo === "detallado";
  const W = ANCHO_BASE, P = 40, X0 = 48, CW = W - X0 - P;        // contenido: de X0 a W-P
  const href = (u) => esc(iconos[u ?? ICONO_RESPALDO] ?? u ?? ICONO_RESPALDO);
  const col = (k) => (k in T ? T[k] : k);
  const partes = [];
  const defs = [];
  let y = 0;

  // ---- cabecera
  if (ap.fondo) {
    defs.push(`<radialGradient id="brillo" cx="1" cy="0" r="0.9"><stop offset="0" stop-color="${cc}" stop-opacity=".30"/><stop offset="1" stop-color="${cc}" stop-opacity="0"/></radialGradient>`);
    partes.push(rect(W * 0.35, 0, W * 0.65, 300, { fill: "url(#brillo)" }));
  }
  partes.push(G.grafica(X0, 26, T.oro), texto(X0 + 34, 48, "OPORTUNIDAD DETECTADA", { tam: 18, peso: 700, color: T.texto, esp: 1.5 }));
  partes.push(G.diamante(X0 - 2, 64, cc), texto(X0 + 42, 98, clase.nombre.toUpperCase(), { tam: 40, peso: 800, color: cc, esp: 0.5 }));
  partes.push(texto(W - P, 50, "MercadoWoW", { tam: 26, peso: 800, color: T.oro, ancla: "end" }),
    texto(W - P, 76, "CRAFTING SNIPER", { tam: 14, peso: 600, color: T.sec, ancla: "end", esp: 2.5 }));
  if (manual) {
    const t = "ENVÍO MANUAL", w = anchoTexto(t, 13, 700) + 24;
    partes.push(rect(W - P - w, 88, w, 26, { rx: 13, fill: T.fondo2, stroke: T.borde }), texto(W - P - w / 2, 106, t, { tam: 13, peso: 700, color: T.sec, ancla: "middle", esp: 1 }));
  }
  y = 128;

  // ---- objeto
  const tamIcono = 124;
  defs.push(`<clipPath id="ico"><rect x="${X0}" y="${y}" width="${tamIcono}" height="${tamIcono}" rx="14"/></clipPath>`);
  const [nomCal, colCal] = CALIDADES[o.calidad] ?? [null, T.borde];
  partes.push(rect(X0 - 3, y - 3, tamIcono + 6, tamIcono + 6, { rx: 16, fill: T.fondo2, stroke: colCal, sw: 3 }),
    `<image href="${href(o.icono)}" x="${X0}" y="${y}" width="${tamIcono}" height="${tamIcono}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ico)"/>`);
  const xn = X0 + tamIcono + 26;
  let anchoBadge = 0;
  if (nomCal) {
    anchoBadge = anchoTexto(nomCal, 20, 700) + 36;
    partes.push(rect(W - P - anchoBadge, y + 6, anchoBadge, 40, { rx: 10, fill: T.fondo2, stroke: colCal, sw: 2 }),
      texto(W - P - anchoBadge / 2, y + 33, nomCal, { tam: 20, peso: 700, color: colCal, ancla: "middle" }));
  }
  const maxNombre = W - P - xn - (anchoBadge ? anchoBadge + 20 : 0);
  const tamNombre = ajustar(o.nombre, 42, 800, maxNombre, 30);
  partes.push(texto(xn, y + 46, recortar(o.nombre, tamNombre, 800, maxNombre), { tam: tamNombre, peso: 800, color: T.texto }));
  partes.push(texto(xn, y + 86, `${nombreProfesion(o.profesion)}${o.nivel != null ? ` · nivel ${o.nivel}` : ""}`, { tam: 22, peso: 500, color: T.texto }));
  if (mercado) partes.push(texto(xn, y + 116, recortar(mercado, 17, 400, W - P - xn), { tam: 17, color: T.sec }));
  y += tamIcono + 30;

  // ---- tres cifras
  const gap = 20, wc = (CW - 2 * gap) / 3, hc = 116;
  const cifras = [
    { t: "Coste de fabricación", v: o.coste, g: "monedas", color: T.texto },
    { t: o.unidades > 1 ? `Precio de venta (c/u · ${o.unidades} u.)` : "Precio de venta", v: o.precioVenta, g: "martillo", color: T.texto },
    { t: "Beneficio neto", v: o.neta, g: "monedas", color: o.neta >= 0 ? T.verde : T.rojo, destacado: true },
  ];
  cifras.forEach((c, i) => {
    const x = X0 + i * (wc + gap);
    const bordeC = c.destacado ? c.color : T.borde;
    partes.push(rect(x, y, wc, hc, { rx: 14, fill: c.destacado ? T.fondo2 : T.tarjeta, stroke: bordeC, sw: c.destacado ? 2.5 : 1 }));
    partes.push(G[c.g](x + 46, y + hc / 2, T));
    const xt = x + 84, disp = wc - 84 - 16;
    partes.push(texto(xt, y + 42, recortar(c.t, 17, 500, disp), { tam: 17, peso: 500, color: T.sec }));
    const signo = c.destacado && c.v > 0 ? "+" : "";
    const tam = Math.min(c.destacado ? 40 : 36, Math.floor((c.destacado ? 40 : 36) * disp / Math.max(1, anchoMoneda(c.v, c.destacado ? 40 : 36, 800, ap) + (signo ? 22 : 0))));
    partes.push(moneda(xt, y + 88, c.v, { tam: Math.max(18, tam), peso: 800, color: c.color, signo, ap, T }));
  });
  y += hc + 24;

  // ---- indicadores
  const cols = [{ k: "roi" }, ...(ap.score ? [{ k: "score" }] : []), ...(ap.riesgo ? [{ k: "riesgo" }] : []), { k: "stock" }];
  const hi = 122, wi = CW / cols.length;
  partes.push(linea(X0, y, W - P, y, T.borde), linea(X0, y + hi, W - P, y + hi, T.borde));
  cols.forEach((c, i) => {
    const x = X0 + i * wi + (i ? 22 : 0), w = wi - (i ? 44 : 22);
    if (i) partes.push(linea(X0 + i * wi, y + 16, X0 + i * wi, y + hi - 16, T.borde));
    if (c.k === "roi") {
      const color = o.roi > 0 ? T.verde : T.rojo;
      partes.push(G.grafica(x, y + 18, color), texto(x + 34, y + 38, "ROI", { tam: 18, peso: 600, color: T.sec }));
      partes.push(texto(x, y + 84, pct(o.roi).replace(" %", "%"), { tam: ajustar(pct(o.roi), 40, 800, w), peso: 800, color }));
      if (ap.barras) {
        const esc2 = Number(ap.escala_roi) || 200;
        partes.push(barra(x, y + 98, w, 10, (o.roi ?? 0) / esc2, color, T));
        if ((o.roi ?? 0) > esc2) partes.push(texto(x + w, y + 38, `escala ${esc2} %`, { tam: 13, color: T.sec, ancla: "end" }));
      }
    } else if (c.k === "score") {
      const s = Math.max(0, Math.min(100, Math.round(o.score ?? 0)));
      const color = s < 40 ? "#EF4444" : s < 60 ? "#F97316" : s < 75 ? "#FACC15" : s < 90 ? "#22C55E" : "#4ADE80";
      partes.push(G.diana(x + 11, y + 28, color), texto(x + 34, y + 38, "MercadoWoW Score", { tam: 18, peso: 600, color: T.sec }));
      partes.push(texto(x, y + 84, `${s}/100`, { tam: 34, peso: 800, color: T.texto }));
      if (ap.barras) partes.push(barra(x, y + 98, w, 10, s / 100, color, T));
    } else if (c.k === "riesgo") {
      const [nom, k] = RIESGOS[o.riesgo] ?? RIESGOS.desconocido;
      const color = col(k);
      partes.push(G.escudo(x, y + 16, color), texto(x + 34, y + 38, "Riesgo", { tam: 18, peso: 600, color: T.sec }));
      partes.push(`<circle cx="${x + 12}" cy="${y + 74}" r="10" fill="${color}"/>`, texto(x + 32, y + 84, nom, { tam: 30, peso: 800, color }));
      if (o.confianza) partes.push(texto(x, y + 110, `confianza ${o.confianza}`, { tam: 14, color: T.sec }));
    } else {
      partes.push(G.cajas(x, y + 16, T.oro), texto(x + 34, y + 38, "Stock", { tam: 18, peso: 600, color: T.sec }));
      const sub = o.stockSubasta == null ? "Sin datos" : o.stockSubasta.toLocaleString("es");
      const fab = o.maxFabricable != null ? o.maxFabricable.toLocaleString("es") : o.stockIlimitado ? "Sin límite" : "Sin datos";
      partes.push(texto(x, y + 72, "En subasta", { tam: 15, color: T.sec }), texto(x + w, y + 72, sub, { tam: 20, peso: 700, color: T.texto, ancla: "end" }));
      partes.push(texto(x, y + 102, "Fabricable", { tam: 15, color: T.sec }), texto(x + w, y + 102, fab, { tam: 20, peso: 700, color: T.texto, ancla: "end" }));
    }
  });
  y += hi + 24;

  // ---- reparto del precio de venta
  if (ap.barras && o.ingresoBruto > 0 && o.coste != null) {
    const com = (o.comision ?? 0) + (o.deposito ?? 0);
    const neta = Math.max(0, o.neta ?? 0);
    const total = Math.max(o.ingresoBruto, o.coste + com + neta);
    const seg = [["Coste", o.coste, "#64748B"], ["Comisión y depósito", com, "#F59E0B"], ["Beneficio", neta, T.verde]].filter((s) => s[1] > 0);
    partes.push(texto(X0, y + 18, `Reparto del precio de venta (${textoMoneda(o.ingresoBruto, ap)} por fabricación)`, { tam: 17, peso: 600, color: T.sec }));
    defs.push(`<clipPath id="reparto"><rect x="${X0}" y="${y + 30}" width="${CW}" height="22" rx="11"/></clipPath>`);
    let x = X0;
    const barras = seg.map(([, v, c], i) => {
      const w = (CW * v) / total;
      const r = rect(x, y + 30, Math.max(0, w - (i < seg.length - 1 ? 3 : 0)), 22, { fill: c });
      x += w; return r;
    }).join("");
    partes.push(`<g clip-path="url(#reparto)">${barras}</g>`);
    let lx = X0;
    for (const [n, v, c] of seg) {
      const t = `${n} ${Math.round((v / total) * 100)} %`;
      partes.push(rect(lx, y + 64, 12, 12, { rx: 3, fill: c }), texto(lx + 18, y + 75, t, { tam: 15, color: T.texto }));
      lx += anchoTexto(t, 15) + 48;
    }
    y += 96;
  }

  // ---- materiales y fabricación recomendada
  const reco = detallado ? fabricacionRecomendada(o, { presupuesto: ap.presupuesto }) : null;
  const mats = ap.materiales ? (o.materiales ?? []) : [];
  if (mats.length || reco) {
    const wr = reco ? 430 : 0, wm = mats.length ? CW - (reco ? wr + 20 : 0) : 0;
    const hFila = 48;
    const hm = mats.length ? 66 + 26 + mats.length * hFila + 58 : 0;
    const hr = reco ? 370 : 0;
    const h = Math.max(hm, hr);
    if (mats.length) {
      const x = X0;
      partes.push(rect(x, y, wm, h, { rx: 14, fill: T.tarjeta, stroke: T.borde }));
      partes.push(G.pergamino(x + 20, y + 20, "#D9B76A"), texto(x + 54, y + 41, "Materiales necesarios", { tam: 21, peso: 700, color: T.texto }));
      // Columnas (de derecha a izquierda): disponible, total, unitario, cantidad.
      const xd = x + wm - 20, xt = xd - (wm > 700 ? 130 : 96), xu = xt - (wm > 700 ? 160 : 120), xq = xu - (wm > 700 ? 120 : 84);
      const yh = y + 76;
      for (const [cx, t] of [[xq, "Cant."], [xu, "Unitario"], [xt, "Total"], [xd, "Disp."]]) partes.push(texto(cx, yh, t, { tam: 14, peso: 600, color: T.sec, ancla: "end" }));
      partes.push(texto(x + 20, yh, "Material", { tam: 14, peso: 600, color: T.sec }));
      mats.forEach((m, i) => {
        const yf = y + 92 + i * hFila;
        const id = `m${i}`;
        defs.push(`<clipPath id="${id}"><rect x="${x + 20}" y="${yf + 7}" width="34" height="34" rx="6"/></clipPath>`);
        partes.push(linea(x + 20, yf, x + wm - 20, yf, T.borde));
        partes.push(`<image href="${href(m.icono)}" x="${x + 20}" y="${yf + 7}" width="34" height="34" clip-path="url(#${id})"/>`);
        const maxN = xq - 60 - (x + 66);
        partes.push(texto(x + 66, yf + 30, recortar(m.nombre ?? `#${m.id}`, 18, 500, maxN), { tam: 18, peso: 500, color: T.texto }));
        if (m.origen === "npc" || m.origen === "fabricar" || m.sinOfertas) {
          const nota = m.origen === "npc" ? "NPC" : m.origen === "fabricar" ? "fabricado" : "valor de mercado";
          partes.push(texto(x + 66, yf + 45, nota, { tam: 12, color: T.sec }));
        }
        const q = Number.isInteger(m.cantidad) ? m.cantidad : Number(m.cantidad).toFixed(2);
        partes.push(texto(xq, yf + 30, `× ${q}`, { tam: 18, color: T.texto, ancla: "end" }));
        const unit = m.precioUnitario ?? (m.cantidad ? m.costeTotal / m.cantidad : null);
        partes.push(moneda(xu, yf + 30, unit, { tam: 17, peso: 500, color: T.sec, ancla: "end", ap, T }));
        partes.push(moneda(xt, yf + 30, m.costeTotal, { tam: 18, peso: 700, color: T.oro, ancla: "end", ap, T }));
        partes.push(texto(xd, yf + 30, m.origen === "npc" ? "NPC" : m.disponible == null ? "—" : m.disponible.toLocaleString("es"), { tam: 16, color: T.sec, ancla: "end" }));
      });
      const yt = y + 92 + mats.length * hFila;
      partes.push(linea(x + 20, yt, x + wm - 20, yt, T.sec, 1.5));
      partes.push(texto(x + 20, yt + 38, "Coste total", { tam: 21, peso: 800, color: T.texto }),
        moneda(xt, yt + 38, o.coste, { tam: 22, peso: 800, color: T.oro, ancla: "end", ap, T }));
    }
    if (reco) {
      const x = X0 + (mats.length ? wm + 20 : 0), w = mats.length ? wr : CW;
      partes.push(rect(x, y, w, h, { rx: 16, fill: T.fondo2, stroke: cc, sw: 2 }));
      partes.push(G.torre(x + 20, y + 18, cc), texto(x + 58, y + 41, "Fabricación recomendada", { tam: 21, peso: 700, color: T.texto }));
      const unidades = reco.veces === 1 ? "1 fabricación" : `${reco.veces.toLocaleString("es")} fabricaciones`;
      partes.push(texto(x + w / 2, y + 96, unidades, { tam: ajustar(unidades, 38, 800, w - 40), peso: 800, color: T.texto, ancla: "middle" }));
      partes.push(texto(x + w / 2, y + 122, `${reco.unidades.toLocaleString("es")} u. · límite: ${reco.limite}`, { tam: 15, color: T.sec, ancla: "middle" }));
      const filas = [["Inversión total", reco.inversion, T.oro], ["Ingreso bruto", reco.ingreso, T.texto], ["Comisión y depósito", reco.comision, T.texto],
        ["Precio mínimo (c/u)", reco.equilibrio, T.texto]];
      filas.forEach(([t, v, c], i) => {
        const yf = y + 140 + i * 42;
        partes.push(rect(x + 18, yf, w - 36, 36, { rx: 8, fill: T.tarjeta, stroke: T.borde }),
          texto(x + 32, yf + 24, t, { tam: 16, color: T.sec }), moneda(x + w - 32, yf + 24, v, { tam: 18, peso: 700, color: c, ancla: "end", ap, T }));
      });
      const yb = y + 140 + filas.length * 42 + 8;
      const colN = reco.neta >= 0 ? T.verde : T.rojo;
      partes.push(rect(x + 18, yb, w - 36, 52, { rx: 10, fill: T.fondo, stroke: colN, sw: 2 }),
        texto(x + 32, yb + 33, "Beneficio potencial", { tam: 18, peso: 700, color: colN }),
        moneda(x + w - 32, yb + 34, reco.neta, { tam: 24, peso: 800, color: colN, ancla: "end", signo: reco.neta > 0 ? "+" : "", ap, T }));
    }
    y += h + 24;
  }

  // ---- gráfico del precio
  if (ap.grafico) {
    const tr = tendencia(serie);
    const h = 190;
    const periodo = PERIODOS[ap.periodo] ?? `${ap.periodo} h`;
    partes.push(linea(X0, y, W - P, y, T.borde));
    const colT = !tr ? T.sec : tr.sentido === "sube" ? T.verde : tr.sentido === "baja" ? T.rojo : T.sec;
    partes.push(G.tendencia(X0, y + 22, T.sec), texto(X0 + 36, y + 44, `Precio de venta · ${periodo}`, { tam: 20, peso: 700, color: T.texto }));
    if (!tr) {
      partes.push(texto(X0 + 36, y + 90, "Historial insuficiente", { tam: 22, peso: 700, color: T.sec }),
        texto(X0 + 36, y + 118, "Hacen falta al menos 3 escaneos del producto en el período.", { tam: 15, color: T.sec }));
    } else {
      // Flecha dibujada (no depende de que la fuente tenga el símbolo).
      const fx = X0 + 36, fy = y + 70;
      partes.push(tr.sentido === "sube" ? `<polygon points="${fx},${fy + 22} ${fx + 12},${fy} ${fx + 24},${fy + 22}" fill="${colT}"/>`
        : tr.sentido === "baja" ? `<polygon points="${fx},${fy} ${fx + 24},${fy} ${fx + 12},${fy + 22}" fill="${colT}"/>`
        : rect(fx, fy + 8, 24, 6, { rx: 3, fill: colT }));
      const v = `${tr.variacion > 0 ? "+" : ""}${tr.variacion.toLocaleString("es", { maximumFractionDigits: 1 })} %`;
      partes.push(texto(X0 + 70, y + 92, v, { tam: 32, peso: 800, color: colT }));
      partes.push(texto(X0 + 36, y + 126, "Máx.", { tam: 15, color: T.sec }), moneda(X0 + 260, y + 126, tr.max, { tam: 16, peso: 600, color: T.texto, ancla: "end", ap, T }));
      partes.push(texto(X0 + 36, y + 152, "Mín.", { tam: 15, color: T.sec }), moneda(X0 + 260, y + 152, tr.min, { tam: 16, peso: 600, color: T.texto, ancla: "end", ap, T }));
      partes.push(texto(X0 + 36, y + 176, `${tr.puntos.length} escaneos`, { tam: 13, color: T.sec }));
      // Área: eje X por tiempo real; eje Y entre el mínimo y el máximo del período (con margen).
      const gx = X0 + 300, gw = W - P - gx, gy = y + 30, gh = h - 50;
      const t0 = tr.puntos[0][0], t1 = tr.puntos[tr.puntos.length - 1][0];
      const margen = (tr.max - tr.min) * 0.12 || tr.max * 0.05 || 1;
      const lo = tr.min - margen, hiV = tr.max + margen;
      const px = (t) => gx + (t1 > t0 ? ((t - t0) / (t1 - t0)) * gw : gw / 2);
      const py = (v) => gy + gh - ((v - lo) / (hiV - lo)) * gh;
      const pts = tr.puntos.map(([t, v]) => `${r1(px(t))},${r1(py(v))}`).join(" ");
      defs.push(`<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colT}" stop-opacity=".35"/><stop offset="1" stop-color="${colT}" stop-opacity="0"/></linearGradient>`);
      partes.push(linea(gx, gy + gh, gx + gw, gy + gh, T.borde));
      partes.push(`<polygon points="${r1(px(t0))},${r1(gy + gh)} ${pts} ${r1(px(t1))},${r1(gy + gh)}" fill="url(#area)"/>`);
      partes.push(`<polyline points="${pts}" fill="none" stroke="${colT}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
      const [ut, uv] = tr.puntos[tr.puntos.length - 1];
      partes.push(`<circle cx="${r1(px(ut))}" cy="${r1(py(uv))}" r="6" fill="${colT}" stroke="${T.fondo}" stroke-width="2"/>`);
    }
    y += h + 10;
  }

  // ---- pie
  partes.push(linea(X0, y, W - P, y, T.borde));
  const zona = ap.zona || undefined;
  let fecha;
  try { fecha = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short", timeZone: zona }).format(new Date(ahora)); }
  catch { fecha = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(new Date(ahora)) + " UTC"; }
  partes.push(texto(X0, y + 40, `Actualizado: ${fecha}`, { tam: 17, color: T.sec }));
  partes.push(texto(X0 + CW / 2, y + 40, proveedor === "ahledger" ? "Prices from AHledger" : "Precios: TradeSkillMaster", { tam: 17, peso: 600, color: T.sec, ancla: "middle" }));
  const dominio = String(sitio || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (dominio) partes.push(texto(W - P, y + 40, dominio, { tam: 17, peso: 600, color: T.enlace, ancla: "end" }));
  partes.push(texto(X0, y + 66, "Estimación con el último escaneo; no garantiza la venta.", { tam: 13, color: T.sec, op: 0.85 }));
  y += 86;

  const alto = Math.ceil(y);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${alto}" width="${W}" height="${alto}">`
    + `<defs><clipPath id="marco"><rect x="0" y="0" width="${W}" height="${alto}" rx="22"/></clipPath>${defs.join("")}</defs>`
    + `<g clip-path="url(#marco)">${rect(0, 0, W, alto, { fill: T.fondo })}${rect(0, 0, 8, alto, { fill: cc })}${partes.join("")}</g>`
    + rect(0.5, 0.5, W - 1, alto - 1, { rx: 22, stroke: T.borde })
    + `</svg>`;
  return { svg, ancho: W, alto };
}
