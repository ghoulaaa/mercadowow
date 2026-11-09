// Mapa de materiales (W3): distribución «squarified» y escala de color. Sin DOM, para probarlo en Node.

/**
 * Reparte un rectángulo entre elementos de peso positivo, con rectángulos lo más cuadrados posible
 * (algoritmo squarified de Bruls, Huizing y van Wijk). El área de cada uno es proporcional a su peso.
 * @param {{peso: number}[]} elementos
 * @returns {{x: number, y: number, w: number, h: number, i: number}[]}  i = índice en `elementos`
 */
export function squarify(elementos, x, y, w, h) {
  const total = elementos.reduce((s, e) => s + e.peso, 0);
  if (!elementos.length || total <= 0 || w <= 0 || h <= 0) return [];
  const escala = (w * h) / total;
  const cola = elementos.map((e, i) => ({ a: e.peso * escala, i })).filter((e) => e.a > 0);
  const salida = [];
  let rx = x, ry = y, rw = w, rh = h;

  const peor = (fila, lado) => {
    const s = fila.reduce((t, e) => t + e.a, 0);
    let max = 0, min = Infinity;
    for (const e of fila) { if (e.a > max) max = e.a; if (e.a < min) min = e.a; }
    return Math.max((lado * lado * max) / (s * s), (s * s) / (lado * lado * min));
  };
  const colocar = (fila) => {
    const s = fila.reduce((t, e) => t + e.a, 0);
    if (rw >= rh) {                     // columna a la izquierda
      const ancho = s / rh;
      let yy = ry;
      for (const e of fila) { const alto = e.a / ancho; salida.push({ x: rx, y: yy, w: ancho, h: alto, i: e.i }); yy += alto; }
      rx += ancho; rw -= ancho;
    } else {                            // fila arriba
      const alto = s / rw;
      let xx = rx;
      for (const e of fila) { const ancho = e.a / alto; salida.push({ x: xx, y: ry, w: ancho, h: alto, i: e.i }); xx += ancho; }
      ry += alto; rh -= alto;
    }
  };

  let fila = [];
  for (const e of cola) {
    const lado = Math.min(rw, rh);
    if (!fila.length || peor([...fila, e], lado) <= peor(fila, lado)) fila.push(e);
    else { colocar(fila); fila = [e]; }
  }
  if (fila.length) colocar(fila);
  return salida;
}

/**
 * Tono de un bloque según su variación (%): neutro si |v| < 1, y tres pasos por lado (< 5, < 15, ≥ 15).
 * Sin variación (sin historial / sin ofertas / sin datos) → su propio aspecto, nunca «0 %».
 */
export function tonoVariacion(v) {
  if (v == null || !Number.isFinite(v)) return "sin";
  const a = Math.abs(v);
  if (a < 1) return "igual";
  const paso = a < 5 ? 1 : a < 15 ? 2 : 3;
  return `${v > 0 ? "sube" : "baja"}-${paso}`;
}

/** «+12,3 %», «−4,0 %», «0,0 %» (siempre con signo cuando no es cero). */
export function textoVariacion(v) {
  if (v == null || !Number.isFinite(v)) return null;
  const r = Math.round(v * 10) / 10;
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
}

/** Nombre abreviado para que quepa: corta por palabras y añade «…». */
export function abreviar(nombre, max) {
  const n = String(nombre ?? "");
  if (n.length <= max) return n;
  if (max <= 1) return "…";
  const corte = n.slice(0, max - 1);
  const espacio = corte.lastIndexOf(" ");
  return (espacio > max * 0.5 ? corte.slice(0, espacio) : corte).trimEnd() + "…";
}

/** Peso de cada bloque: cantidad publicada (si la fuente la da y hay ofertas) o 1 (tamaño uniforme). */
export function pesoBloque(o, tamano) {
  if (tamano !== "cantidad") return 1;
  return o.cantidad > 0 ? o.cantidad : 0;
}
