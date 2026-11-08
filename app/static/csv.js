// Lectura de archivos CSV de precios en el navegador, antes de enviarlos al servidor.
// Política: si hay CUALQUIER error, no se importa nada (mejor nada que datos dudosos).

import { parsearMoneda } from "./moneda.js";

export const MAX_FILAS = 20_000;
export const MAX_ERRORES = 50;

/** Parser CSV (RFC 4180): comillas, comillas dobles, comas y saltos de línea dentro de campos, BOM. */
export function parsearCsv(texto) {
  const filas = [];
  let fila = [], campo = "", enComillas = false;
  let i = texto.charCodeAt(0) === 0xfeff ? 1 : 0;
  // Separador: coma, o punto y coma (Excel en español) si la cabecera lo usa.
  const primera = texto.slice(i, texto.indexOf("\n") === -1 ? undefined : texto.indexOf("\n"));
  const sep = primera.includes(";") && !primera.includes(",") ? ";" : ",";
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (!(fila.length === 1 && fila[0] === "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (enComillas) throw new Error("CSV mal formado: hay comillas sin cerrar");
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// Nombres de columna aceptados (sin distinguir mayúsculas, espacios ni guiones bajos).
const ALIAS = {
  item_id: ["itemid", "id", "item"],
  name: ["name", "nombre", "objeto"],
  min_buyout: ["minbuyout", "precio", "preciominimo", "compramínima", "compraminima", "buyout"],
  market_value: ["marketvalue", "valormercado", "valordemercado"],
  recent: ["recent", "reciente"],
  historical: ["historical", "historico", "histórico"],
  updated_at: ["updatedat", "fecha", "hora", "horadato"],
};

const normalizar = (s) => s.trim().toLowerCase().replace(/[\s_\-]/g, "");

function mapearColumnas(cabecera) {
  const mapa = {};
  cabecera.forEach((nombre, idx) => {
    const n = normalizar(nombre);
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (alias.includes(n) && mapa[campo] === undefined) mapa[campo] = idx;
    }
  });
  return mapa;
}

/**
 * Valida un CSV de precios.
 * @param {string} texto contenido del archivo
 * @param {string|null} horaManual ISO de la hora del dato si el archivo no trae columna de fecha
 * @returns {{filas: object[], horaDato: string|null, errores: string[], avisos: string[], columnas: string[]}}
 */
export function leerCsvPrecios(texto, horaManual = null) {
  const errores = [], avisos = [];
  const error = (m) => { if (errores.length < MAX_ERRORES) errores.push(m); };
  let tabla;
  try {
    tabla = parsearCsv(texto);
  } catch (e) {
    return { filas: [], horaDato: null, errores: [e.message], avisos, columnas: [] };
  }
  if (tabla.length < 2) {
    return { filas: [], horaDato: null, errores: ["El archivo no tiene filas de datos"], avisos, columnas: [] };
  }

  const mapa = mapearColumnas(tabla[0]);
  const columnas = Object.keys(mapa);
  if (mapa.item_id === undefined) error("Falta la columna del identificador del objeto (itemId)");
  if (mapa.name === undefined) error("Falta la columna del nombre (name o nombre)");
  if (mapa.min_buyout === undefined && mapa.market_value === undefined) {
    error("Falta una columna de precio (minBuyout/precio o marketValue)");
  }
  if (mapa.updated_at === undefined && !horaManual) {
    error("El archivo no trae la hora del dato (updatedAt/fecha): indícala a mano");
  }
  if (tabla.length - 1 > MAX_FILAS) error(`Demasiadas filas (${tabla.length - 1}); el máximo es ${MAX_FILAS}`);
  if (errores.length) return { filas: [], horaDato: null, errores, avisos, columnas };

  const porItem = new Map();
  let horaDato = null;
  const ancho = tabla[0].length;

  for (let k = 1; k < tabla.length; k++) {
    const r = tabla[k], linea = k + 1;
    if (r.length !== ancho) { error(`Línea ${linea}: ${r.length} columnas en vez de ${ancho}`); continue; }
    const idTxt = r[mapa.item_id].trim();
    if (!/^\d+$/.test(idTxt) || Number(idTxt) <= 0 || Number(idTxt) > 2_147_483_647) {
      error(`Línea ${linea}: itemId no válido ${JSON.stringify(idTxt)}`); continue;
    }
    const nombre = r[mapa.name].trim();
    if (!nombre) { error(`Línea ${linea}: falta el nombre`); continue; }

    const fila = { item_id: Number(idTxt), name: nombre, min_buyout: null, market_value: null, recent: null, historical: null };
    let ok = true;
    for (const campo of ["min_buyout", "market_value", "recent", "historical"]) {
      if (mapa[campo] === undefined) continue;
      try { fila[campo] = parsearMoneda(r[mapa[campo]]); }
      catch (e) { error(`Línea ${linea}: ${e.message}`); ok = false; }
    }
    if (!ok) continue;
    if (fila.min_buyout === null && fila.market_value === null) {
      error(`Línea ${linea}: sin ningún precio`); continue;
    }

    if (mapa.updated_at !== undefined) {
      const t = Date.parse(r[mapa.updated_at].trim());
      if (Number.isNaN(t)) { error(`Línea ${linea}: fecha no válida ${JSON.stringify(r[mapa.updated_at])}`); continue; }
      const iso = new Date(t).toISOString();
      if (horaDato === null) horaDato = iso;
      else if (horaDato !== iso) { error(`Línea ${linea}: fecha distinta al resto (${iso}); un archivo = una hora del dato`); continue; }
    }
    if (porItem.has(fila.item_id)) avisos.push(`Objeto ${fila.item_id} repetido: se usa la última fila`);
    porItem.set(fila.item_id, fila);
  }

  if (mapa.updated_at === undefined) {
    const t = Date.parse(horaManual);
    if (Number.isNaN(t)) error("La hora del dato indicada no es válida");
    else horaDato = new Date(t).toISOString();
  }
  if (horaDato && Date.parse(horaDato) > Date.now() + 10 * 60_000) error("La hora del dato está en el futuro");

  return {
    filas: errores.length ? [] : [...porItem.values()],
    horaDato: errores.length ? null : horaDato,
    errores,
    avisos: avisos.slice(0, 10),
    columnas,
  };
}
