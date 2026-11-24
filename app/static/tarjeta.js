// Tarjeta gráfica del Crafting Sniper (SVG). Sin DOM ni red: el MISMO código dibuja la vista previa de la
// página (SVG en línea) y la imagen que llega a Discord (la Edge Function convierte este SVG en PNG con resvg).
// Todo sale de los datos reales de la oportunidad; lo que falta se dice («Sin datos», «Historial
// insuficiente»), nunca se inventa. Las cifras en cobre (enteros) y con el formato de monedas de WoW.

import { APARIENCIA_DEFECTO, ICONO_RESPALDO, claseDe, fabricacionRecomendada, normalizarApariencia, nombreProfesion } from "./sniper.js";

export const ANCHO_BASE = 800;             // unidades del dibujo; el PNG se escala al ancho elegido
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

// Discord encaja la imagen de un embed en un recuadro de ~400 × 300 px: una tarjeta alta se encoge y no se lee.
// Por eso son DOS tarjetas apaisadas (como mucho 4:3) con letra grande: «resumen» (cifras) y «detalle»
// (materiales e historial). Medidas en unidades del dibujo: ANCHO_BASE × ALTO_MAX.
export const ALTO_MAX = 600;
const X0 = 40, DER = ANCHO_BASE - 32, CW = DER - X0;

/** Qué tarjetas lleva una oportunidad: siempre el resumen; el detalle si hay materiales que mostrar o gráfico. */
export function partesTarjeta(o, apariencia = null) {
  const ap = normalizarApariencia(apariencia);
  return ap.grafico || (ap.materiales && (o.materiales ?? []).length) ? ["resumen", "detalle"] : ["resumen"];
}

/** Caja con un rótulo arriba (tamaño 20–22) y un importe grande que se ajusta al ancho. */
function cajaImporte(x, y, w, h, rotulo, cobre, { T, ap, color, max = 36, tamRot = 20, fondo, borde, sw = 1, signo = "" }) {
  const disp = w - 48;
  const tam = Math.max(20, Math.min(max, Math.floor(max * disp / Math.max(1, anchoMoneda(cobre, max, 800, ap) + (signo ? max * 0.6 : 0)))));
  return rect(x, y, w, h, { rx: 16, fill: fondo ?? T.tarjeta, stroke: borde ?? T.borde, sw })
    + texto(x + 24, y + tamRot + 18, recortar(rotulo, tamRot, 600, disp), { tam: tamRot, peso: 600, color: T.sec })
    + moneda(x + 24, y + h - 26, cobre, { tam, peso: 800, color, signo, ap, T });
}

function resumen(o, c) {
  const { ap, T, cc, href, col, defs, partes, manual, clase } = c;
  const W = ANCHO_BASE;
  // ---- cabecera: clase y marca
  if (ap.fondo) {
    defs.push(`<radialGradient id="r-brillo" cx="1" cy="0" r="0.9"><stop offset="0" stop-color="${cc}" stop-opacity=".30"/><stop offset="1" stop-color="${cc}" stop-opacity="0"/></radialGradient>`);
    partes.push(rect(W * 0.3, 0, W * 0.7, 220, { fill: "url(#r-brillo)" }));
  }
  partes.push(G.diamante(X0, 16, cc),
    texto(X0 + 44, 46, recortar(clase.nombre.toUpperCase(), 30, 800, CW - 250), { tam: 30, peso: 800, color: cc, esp: 0.5 }),
    texto(DER, 42, "MercadoWoW", { tam: 24, peso: 800, color: T.oro, ancla: "end" }));
  if (manual) partes.push(texto(DER, 64, "ENVÍO MANUAL", { tam: 14, peso: 700, color: T.sec, ancla: "end", esp: 1.5 }));

  // ---- objeto: icono real, nombre y profesión
  const yi = 76, ti = 92;
  const [nomCal, colCal] = CALIDADES[o.calidad] ?? [null, T.borde];
  defs.push(`<clipPath id="r-ico"><rect x="${X0}" y="${yi}" width="${ti}" height="${ti}" rx="12"/></clipPath>`);
  partes.push(rect(X0 - 3, yi - 3, ti + 6, ti + 6, { rx: 14, fill: T.fondo2, stroke: colCal, sw: 3 }),
    `<image href="${href(o.icono)}" x="${X0}" y="${yi}" width="${ti}" height="${ti}" preserveAspectRatio="xMidYMid slice" clip-path="url(#r-ico)"/>`);
  const xn = X0 + ti + 22, maxN = DER - xn;
  const tamN = ajustar(o.nombre, 38, 800, maxN, 26);
  partes.push(texto(xn, yi + 42, recortar(o.nombre, tamN, 800, maxN), { tam: tamN, peso: 800, color: T.texto }));
  const sub = `${nombreProfesion(o.profesion)}${o.nivel != null ? ` · nivel ${o.nivel}` : ""}${nomCal ? ` · ${nomCal}` : ""}`;
  partes.push(texto(xn, yi + 80, recortar(sub, 22, 500, maxN), { tam: 22, peso: 500, color: T.sec }));

  // ---- fila 1: beneficio neto (destacado) y ROI
  const y1 = 186, h1 = 124, wN = Math.round(CW * 0.58), xR = X0 + wN + 16, wR = DER - xR;
  const colN = o.neta >= 0 ? T.verde : T.rojo;
  partes.push(cajaImporte(X0, y1, wN, h1, "Beneficio neto", o.neta, { T, ap, color: colN, max: 54, tamRot: 22, fondo: T.fondo2, borde: colN, sw: 2.5,
    signo: o.neta > 0 ? "+" : "" }));
  const colR = o.roi > 0 ? T.verde : T.rojo;
  partes.push(rect(xR, y1, wR, h1, { rx: 16, fill: T.tarjeta, stroke: T.borde }),
    texto(xR + 24, y1 + 40, "ROI", { tam: 22, peso: 600, color: T.sec }));
  const vR = pct(o.roi).replace(" %", "%");
  partes.push(texto(xR + 24, y1 + (ap.barras ? 90 : 100), vR, { tam: ajustar(vR, 50, 800, wR - 48, 24), peso: 800, color: colR }));
  if (ap.barras) {
    const escala = Number(ap.escala_roi) || 200;
    partes.push(barra(xR + 24, y1 + 104, wR - 48, 8, (o.roi ?? 0) / escala, colR, T));
    if ((o.roi ?? 0) > escala) partes.push(texto(DER - 24, y1 + 40, `escala ${escala} %`, { tam: 16, color: T.sec, ancla: "end" }));
  }

  // ---- fila 2: coste y venta
  const y2 = 326, h2 = 98, w2 = (CW - 16) / 2;
  partes.push(cajaImporte(X0, y2, w2, h2, "Coste de fabricación", o.coste, { T, ap, color: T.texto }),
    cajaImporte(X0 + w2 + 16, y2, w2, h2, o.unidades > 1 ? `Venta (c/u · ${o.unidades} u.)` : "Precio de venta", o.precioVenta, { T, ap, color: T.texto }));

  // ---- fila 3: Score, riesgo y stock
  const y3 = 440, h3 = 102;
  const cols = [...(ap.score ? ["score"] : []), ...(ap.riesgo ? ["riesgo"] : []), "stock"];
  const w3 = (CW - 16 * (cols.length - 1)) / cols.length;
  cols.forEach((k, i) => {
    const x = X0 + i * (w3 + 16), xi = x + 22, wi = w3 - 44;
    partes.push(rect(x, y3, w3, h3, { rx: 16, fill: T.tarjeta, stroke: T.borde }));
    if (k === "score") {
      const s = Math.max(0, Math.min(100, Math.round(o.score ?? 0)));
      const color = s < 40 ? "#EF4444" : s < 60 ? "#F97316" : s < 75 ? "#FACC15" : s < 90 ? "#22C55E" : "#4ADE80";
      partes.push(texto(xi, y3 + 34, "Score", { tam: 20, peso: 600, color: T.sec }),
        texto(xi, y3 + (ap.barras ? 74 : 82), `${s}/100`, { tam: 34, peso: 800, color: T.texto }));
      if (ap.barras) partes.push(barra(xi, y3 + 84, wi, 8, s / 100, color, T));
    } else if (k === "riesgo") {
      const [nom, kc] = RIESGOS[o.riesgo] ?? RIESGOS.desconocido;
      const color = col(kc);
      partes.push(texto(xi, y3 + 34, "Riesgo", { tam: 20, peso: 600, color: T.sec }),
        `<circle cx="${xi + 11}" cy="${y3 + 70}" r="11" fill="${color}"/>`,
        texto(xi + 32, y3 + 81, nom, { tam: ajustar(nom, 32, 800, wi - 32, 20), peso: 800, color }));
    } else {
      const sub = o.stockSubasta == null ? "Sin datos" : o.stockSubasta.toLocaleString("es");
      const fab = o.maxFabricable != null ? o.maxFabricable.toLocaleString("es") : o.stockIlimitado ? "Sin límite" : "Sin datos";
      partes.push(texto(xi, y3 + 34, "Stock", { tam: 20, peso: 600, color: T.sec }),
        texto(xi, y3 + 64, "En subasta", { tam: 19, color: T.sec }), texto(xi + wi, y3 + 64, sub, { tam: 22, peso: 700, color: T.texto, ancla: "end" }),
        texto(xi, y3 + 90, "Fabricable", { tam: 19, color: T.sec }), texto(xi + wi, y3 + 90, fab, { tam: 22, peso: 700, color: T.texto, ancla: "end" }));
    }
  });

  // ---- pie: fuente de los precios (obligatoria con AHledger), hora y web
  partes.push(linea(X0, 558, DER, 558, T.borde),
    texto(X0, 588, `${c.fuente} · ${c.fecha}`, { tam: 18, peso: 500, color: T.sec }));
  if (c.dominio) partes.push(texto(DER, 588, c.dominio, { tam: 18, peso: 600, color: T.enlace, ancla: "end" }));
  return ALTO_MAX;
}

function detalle(o, c, serie) {
  const { ap, T, href, defs, partes } = c;
  const mats = ap.materiales ? (o.materiales ?? []) : [];
  const hGraf = ap.grafico ? 210 : 0, hPie = 44, hFila = 44;
  let y = 0;

  // ---- materiales (cantidad y coste total, con su icono real)
  if (mats.length) {
    partes.push(G.pergamino(X0, 22, "#D9B76A"), texto(X0 + 36, 46, "Materiales necesarios", { tam: 26, peso: 700, color: T.texto }));
    const caben = Math.max(1, Math.floor((ALTO_MAX - hGraf - hPie - 68 - 56) / hFila));
    const vista = mats.length <= caben ? mats : mats.slice(0, caben - 1);
    const xq = DER - 200;
    vista.forEach((m, i) => {
      const yf = 68 + i * hFila, id = `d-m${i}`;
      defs.push(`<clipPath id="${id}"><rect x="${X0}" y="${yf + 5}" width="34" height="34" rx="6"/></clipPath>`);
      partes.push(linea(X0, yf, DER, yf, T.borde),
        `<image href="${href(m.icono)}" x="${X0}" y="${yf + 5}" width="34" height="34" clip-path="url(#${id})"/>`,
        texto(X0 + 48, yf + 31, recortar(m.nombre ?? `#${m.id}`, 22, 500, xq - 80 - (X0 + 48)), { tam: 22, peso: 500, color: T.texto }));
      const q = Number.isInteger(m.cantidad) ? m.cantidad : Number(m.cantidad).toFixed(2);
      partes.push(texto(xq, yf + 31, `× ${q}`, { tam: 22, peso: 600, color: T.sec, ancla: "end" }),
        moneda(DER, yf + 31, m.costeTotal, { tam: 22, peso: 700, color: T.oro, ancla: "end", ap, T }));
    });
    let yt = 68 + vista.length * hFila;
    if (vista.length < mats.length) {
      partes.push(linea(X0, yt, DER, yt, T.borde), texto(X0 + 48, yt + 30, `y ${mats.length - vista.length} más…`, { tam: 20, color: T.sec }));
      yt += hFila;
    }
    partes.push(linea(X0, yt, DER, yt, T.sec, 1.5), texto(X0, yt + 38, "Coste total", { tam: 24, peso: 800, color: T.texto }),
      moneda(DER, yt + 38, o.coste, { tam: 26, peso: 800, color: T.oro, ancla: "end", ap, T }));
    y = yt + 56;
  }

  // ---- historial real del precio de venta
  if (ap.grafico) {
    const tr = tendencia(serie);
    const periodo = PERIODOS[ap.periodo] ?? `${ap.periodo} h`;
    if (y) partes.push(linea(X0, y, DER, y, T.borde));
    const colT = !tr ? T.sec : tr.sentido === "sube" ? T.verde : tr.sentido === "baja" ? T.rojo : T.sec;
    partes.push(G.tendencia(X0, y + 20, T.sec), texto(X0 + 36, y + 42, `Precio de venta · ${periodo}`, { tam: 24, peso: 700, color: T.texto }));
    if (!tr) {
      partes.push(texto(X0, y + 104, "Historial insuficiente", { tam: 28, peso: 700, color: T.sec }),
        texto(X0, y + 138, "Hacen falta al menos 3 escaneos en el período.", { tam: 20, color: T.sec }));
    } else {
      const v = `${tr.variacion > 0 ? "+" : ""}${tr.variacion.toLocaleString("es", { maximumFractionDigits: 1 })} %`;
      partes.push(texto(DER, y + 44, v, { tam: 30, peso: 800, color: colT, ancla: "end" }));
      // Flecha dibujada (no depende de que la fuente tenga el símbolo).
      const fx = DER - anchoTexto(v, 30, 800) - 34, fy = y + 22;
      partes.push(tr.sentido === "sube" ? `<polygon points="${fx},${fy + 22} ${fx + 12},${fy} ${fx + 24},${fy + 22}" fill="${colT}"/>`
        : tr.sentido === "baja" ? `<polygon points="${fx},${fy} ${fx + 24},${fy} ${fx + 12},${fy + 22}" fill="${colT}"/>`
        : rect(fx, fy + 8, 24, 6, { rx: 3, fill: colT }));
      // Eje X por tiempo real; eje Y entre el mínimo y el máximo del período (con margen).
      const gx = X0, gw = CW, gy = y + 62, gh = 100;
      const t0 = tr.puntos[0][0], t1 = tr.puntos[tr.puntos.length - 1][0];
      const margen = (tr.max - tr.min) * 0.12 || tr.max * 0.05 || 1;
      const lo = tr.min - margen, hiV = tr.max + margen;
      const px = (t) => gx + (t1 > t0 ? ((t - t0) / (t1 - t0)) * gw : gw / 2);
      const py = (val) => gy + gh - ((val - lo) / (hiV - lo)) * gh;
      const pts = tr.puntos.map(([t, val]) => `${r1(px(t))},${r1(py(val))}`).join(" ");
      defs.push(`<linearGradient id="d-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colT}" stop-opacity=".35"/><stop offset="1" stop-color="${colT}" stop-opacity="0"/></linearGradient>`);
      partes.push(linea(gx, gy + gh, gx + gw, gy + gh, T.borde),
        `<polygon points="${r1(px(t0))},${r1(gy + gh)} ${pts} ${r1(px(t1))},${r1(gy + gh)}" fill="url(#d-area)"/>`,
        `<polyline points="${pts}" fill="none" stroke="${colT}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`);
      const [ut, uv] = tr.puntos[tr.puntos.length - 1];
      partes.push(`<circle cx="${r1(px(ut))}" cy="${r1(py(uv))}" r="7" fill="${colT}" stroke="${T.fondo}" stroke-width="2"/>`);
      const yb = y + 194;
      partes.push(texto(X0, yb, "Mín.", { tam: 20, color: T.sec }), moneda(X0 + 52, yb, tr.min, { tam: 20, peso: 700, color: T.texto, ap, T }),
        texto(X0 + 300, yb, "Máx.", { tam: 20, color: T.sec }), moneda(X0 + 354, yb, tr.max, { tam: 20, peso: 700, color: T.texto, ap, T }),
        texto(DER, yb, `${tr.puntos.length} escaneos`, { tam: 18, color: T.sec, ancla: "end" }));
    }
    y += hGraf;
  }

  // ---- pie
  partes.push(linea(X0, y + 6, DER, y + 6, T.borde),
    texto(X0, y + 34, "Estimación con el último escaneo; no garantiza la venta.", { tam: 17, color: T.sec }));
  return Math.min(ALTO_MAX, Math.ceil(y + hPie));
}

/**
 * Dibuja una de las tarjetas (`parte`: «resumen» o «detalle»). `o`: oportunidad (evaluarFila / resumen del
 * análisis). Opciones: apariencia, mercado (nombre), proveedor («tsm»/«ahledger»), serie (historial real de la
 * compra mínima), ahora (ms), manual, sitio, iconos ({url: href}: en el servidor, el icono incrustado en base64).
 * @returns {{svg: string, ancho: number, alto: number}}  en unidades del dibujo (ANCHO_BASE × hasta ALTO_MAX).
 */
export function tarjetaSVG(o, { apariencia = null, mercado = "", proveedor = "tsm", serie = null, ahora = Date.now(), manual = false,
                                 sitio = "", iconos = {}, parte = "resumen" } = {}) {
  const ap = normalizarApariencia(apariencia);
  const T = TEMAS[ap.tema] ?? TEMAS.oscuro;
  const clase = claseDe(o.clase);
  const cc = /^#[0-9A-Fa-f]{6}$/.test(ap.colores?.[clase.clave] ?? "") ? ap.colores[clase.clave] : `#${clase.color.toString(16).padStart(6, "0")}`;
  let fecha;
  try { fecha = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short", timeZone: ap.zona || undefined }).format(new Date(ahora)); }
  catch { fecha = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(new Date(ahora)) + " UTC"; }
  const c = {
    ap, T, cc, clase, manual, mercado, fecha, defs: [], partes: [],
    href: (u) => esc(iconos[u ?? ICONO_RESPALDO] ?? u ?? ICONO_RESPALDO),
    col: (k) => (k in T ? T[k] : k),
    fuente: proveedor === "ahledger" ? "Prices from AHledger" : "Precios: TradeSkillMaster",
    dominio: String(sitio || "").replace(/^https?:\/\//, "").replace(/\/+$/, ""),
  };
  const W = ANCHO_BASE;
  const alto = parte === "detalle" ? detalle(o, c, serie) : resumen(o, c);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${alto}" width="${W}" height="${alto}">`
    + `<defs><clipPath id="marco-${parte}"><rect x="0" y="0" width="${W}" height="${alto}" rx="20"/></clipPath>${c.defs.join("")}</defs>`
    + `<g clip-path="url(#marco-${parte})">${rect(0, 0, W, alto, { fill: T.fondo })}${rect(0, 0, 8, alto, { fill: cc })}${c.partes.join("")}</g>`
    + rect(0.5, 0.5, W - 1, alto - 1, { rx: 20, stroke: T.borde })
    + `</svg>`;
  return { svg, ancho: W, alto };
}
