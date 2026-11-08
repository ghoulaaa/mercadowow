// Oro, plata y cobre. 1 oro = 100 platas = 10 000 cobres. Todo se guarda en cobre (entero).

export const COBRE_POR_PLATA = 100;
export const COBRE_POR_ORO = 10_000;

/** 123456 → "12o 34p 56c". null/undefined → "—". Negativos con signo. Omite unidades a cero. */
export function formatearMoneda(cobre) {
  if (cobre === null || cobre === undefined || Number.isNaN(cobre)) return "—";
  if (!Number.isFinite(cobre)) return "—";
  const signo = cobre < 0 ? "−" : "";
  let resto = Math.round(Math.abs(cobre));
  const oro = Math.floor(resto / COBRE_POR_ORO);
  resto -= oro * COBRE_POR_ORO;
  const plata = Math.floor(resto / COBRE_POR_PLATA);
  const cobres = resto - plata * COBRE_POR_PLATA;
  const partes = [];
  if (oro) partes.push(`${oro.toLocaleString("es")}o`);
  if (plata) partes.push(`${plata}p`);
  if (cobres || partes.length === 0) partes.push(`${cobres}c`);
  return signo + partes.join(" ");
}

/**
 * Convierte un texto de precio a cobre.
 *   "123456"            → 123456   (un número entero sin unidad se interpreta como COBRE, como en TSM)
 *   "12o 34p 56c"       → 123456
 *   "12g34s56c"         → 123456   (también acepta g/s/c en inglés)
 *   ""                  → null
 * Rechaza decimales sin unidad ("12.5"): es ambiguo si son oros o cobres.
 */
export function parsearMoneda(texto) {
  if (texto === null || texto === undefined) return null;
  const t = String(texto).trim().toLowerCase().replace(/\s+/g, "");
  if (t === "") return null;
  if (/^\d+$/.test(t)) return comprobar(Number(t), texto);
  const m = t.match(/^(?:(\d+)[og])?(?:(\d+)[ps])?(?:(\d+)c)?$/);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
    throw new Error(`Precio no válido: ${JSON.stringify(String(texto))} (usa cobre entero o 12o 34p 56c)`);
  }
  const plata = Number(m[2] ?? 0), cobre = Number(m[3] ?? 0);
  if (plata >= 100 || cobre >= 100) {
    throw new Error(`Precio no válido: ${JSON.stringify(String(texto))} (plata y cobre van de 0 a 99)`);
  }
  return comprobar(Number(m[1] ?? 0) * COBRE_POR_ORO + plata * COBRE_POR_PLATA + cobre, texto);
}

function comprobar(n, original) {
  if (!Number.isSafeInteger(n)) throw new Error(`Precio demasiado grande: ${String(original)}`);
  return n;
}
