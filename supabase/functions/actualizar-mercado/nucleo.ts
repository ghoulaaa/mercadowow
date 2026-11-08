// Lógica de la actualización, sin dependencias de Deno ni de Supabase,
// para poder probarla en Node con una base de datos simulada (PGlite).

export const COLUMNAS_TSM = [
  "itemId", "name", "marketValue", "minBuyout", "recent", "historical", "updatedAt",
] as const;

export interface Fila {
  item_id: number;
  name: string;
  market_value: number | null;
  min_buyout: number | null;
  recent: number | null;
  historical: number | null;
}

export interface ArchivoTsm {
  filas: Fila[];
  updatedAt: string;      // hora del escaneo original (ISO, UTC)
  duplicadas: number;
}

export class ErrorFormato extends Error {}

/** Parser CSV (RFC 4180): comillas, comillas dobles escapadas, comas y saltos dentro de campos. */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  let i = 0;
  if (texto.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ",") {
      fila.push(campo); campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (!(fila.length === 1 && fila[0] === "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (enComillas) throw new ErrorFormato("CSV mal formado: comillas sin cerrar");
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

function cobre(valor: string, columna: string, linea: number): number | null {
  if (valor === "") return null;
  if (!/^\d+$/.test(valor)) {
    throw new ErrorFormato(`Línea ${linea}: ${columna}=${JSON.stringify(valor)} no es un entero en cobre`);
  }
  const n = Number(valor);
  if (!Number.isSafeInteger(n)) throw new ErrorFormato(`Línea ${linea}: ${columna} demasiado grande`);
  return n;
}

/** Valida y convierte el CSV de TSM. Si el formato cambia, falla en vez de guardar datos dudosos. */
export function leerArchivoTsm(texto: string): ArchivoTsm {
  const tabla = parsearCsv(texto);
  if (tabla.length === 0) throw new ErrorFormato("Archivo vacío");

  const cabecera = tabla[0].map((c) => c.trim());
  if (cabecera.join(",") !== COLUMNAS_TSM.join(",")) {
    throw new ErrorFormato(
      `Columnas inesperadas: ${cabecera.join(",")} (se esperaba ${COLUMNAS_TSM.join(",")})`,
    );
  }

  const porItem = new Map<number, Fila>();
  let updatedAt: string | null = null;
  let total = 0;

  for (let k = 1; k < tabla.length; k++) {
    const linea = k + 1;
    const r = tabla[k];
    if (r.length !== COLUMNAS_TSM.length) {
      throw new ErrorFormato(`Línea ${linea}: ${r.length} columnas en vez de ${COLUMNAS_TSM.length}`);
    }
    const itemId = Number(r[0]);
    if (!/^\d+$/.test(r[0]) || itemId <= 0 || itemId > 2_147_483_647) {
      throw new ErrorFormato(`Línea ${linea}: itemId inválido ${JSON.stringify(r[0])}`);
    }
    const fecha = Date.parse(r[6]);
    if (Number.isNaN(fecha)) throw new ErrorFormato(`Línea ${linea}: updatedAt inválido ${JSON.stringify(r[6])}`);
    const iso = new Date(fecha).toISOString();
    if (updatedAt === null) updatedAt = iso;
    else if (updatedAt !== iso) {
      // TSM documenta que todas las filas comparten updatedAt. Si no, algo raro pasa.
      throw new ErrorFormato(`Línea ${linea}: updatedAt distinto (${iso} ≠ ${updatedAt})`);
    }
    total++;
    porItem.set(itemId, {
      item_id: itemId,
      name: r[1],
      market_value: cobre(r[2], "marketValue", linea),
      min_buyout: cobre(r[3], "minBuyout", linea),
      recent: cobre(r[4], "recent", linea),
      historical: cobre(r[5], "historical", linea),
    });
  }

  if (updatedAt === null) throw new ErrorFormato("El archivo no tiene filas de datos");
  return { filas: [...porItem.values()], updatedAt, duplicadas: total - porItem.size };
}

// ---------------------------------------------------------------------

export interface Db {
  consulta(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

export interface Opciones {
  mercado: string;
  fetch: typeof fetch;
  ahora?: () => Date;
  timeoutMs?: number;
  userAgent?: string;
  runId?: string;
}

export interface Resultado {
  estado: "omitido" | "nuevo_dato" | "sin_cambios" | "no_modificado" | "error";
  detalle: Record<string, unknown>;
}

async function llamar(db: Db, sql: string, params: unknown[]): Promise<Record<string, unknown>> {
  const filas = await db.consulta(sql, params);
  const r = filas[0]?.r;
  return (typeof r === "string" ? JSON.parse(r) : r) as Record<string, unknown>;
}

function segundosRetryAfter(valor: string | null, ahora: Date): number | null {
  if (!valor) return null;
  if (/^\d+$/.test(valor.trim())) return Math.min(Number(valor), 24 * 3600);
  const fecha = Date.parse(valor);
  if (Number.isNaN(fecha)) return null;
  return Math.max(0, Math.min(Math.ceil((fecha - ahora.getTime()) / 1000), 24 * 3600));
}

/** Una ejecución completa: reservar turno → descargar → registrar resultado. */
export async function ejecutar(db: Db, o: Opciones): Promise<Resultado> {
  const ahora = o.ahora ?? (() => new Date());
  const runId = o.runId ?? crypto.randomUUID();
  const mk = o.mercado;

  const turno = await llamar(db, "select tomar_turno($1, $2::uuid, $3::timestamptz) as r",
    [mk, runId, ahora().toISOString()]);
  if (!turno.ok) return { estado: "omitido", detalle: turno };

  const fallo = async (http: number | null, mensaje: string, retryAfter: number | null = null) => {
    const r = await llamar(db,
      "select registrar_fallo($1, $2::uuid, $3::integer, $4, $5::integer, $6::timestamptz) as r",
      [mk, runId, http, mensaje, retryAfter, ahora().toISOString()]);
    return { estado: "error" as const, detalle: { ...r, mensaje } };
  };

  let respuesta: Response;
  try {
    const cabeceras: Record<string, string> = {
      "User-Agent": o.userAgent ?? "mercadowow/0.1 (uso personal)",
    };
    if (turno.etag) cabeceras["If-None-Match"] = String(turno.etag);
    if (turno.last_modified) cabeceras["If-Modified-Since"] = String(turno.last_modified);
    respuesta = await o.fetch(String(turno.url), {
      headers: cabeceras,
      signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
    });
  } catch (e) {
    return await fallo(null, `Error de conexión: ${(e as Error).message ?? e}`);
  }

  try {
    if (respuesta.status === 304) {
      await respuesta.body?.cancel();
      const r = await llamar(db, "select registrar_no_modificado($1, $2::uuid, $3::timestamptz) as r",
        [mk, runId, ahora().toISOString()]);
      return { estado: "no_modificado", detalle: r };
    }

    if (respuesta.status !== 200) {
      await respuesta.body?.cancel();
      return await fallo(respuesta.status, `HTTP ${respuesta.status} del proveedor`,
        segundosRetryAfter(respuesta.headers.get("Retry-After"), ahora()));
    }

    const texto = await respuesta.text();
    const archivo = leerArchivoTsm(texto);
    // $6::text::jsonb (no $6::jsonb): con un parámetro jsonb, el driver postgres.js de la
    // Edge Function vuelve a serializar el texto y llega un escalar JSON en vez del array.
    const r = await llamar(db,
      "select registrar_snapshot($1, $2::uuid, $3, $4, $5::timestamptz, $6::text::jsonb, $7::timestamptz) as r",
      [mk, runId, respuesta.headers.get("ETag"), respuesta.headers.get("Last-Modified"),
        archivo.updatedAt, JSON.stringify(archivo.filas), ahora().toISOString()]);
    return {
      estado: r.estado as Resultado["estado"],
      detalle: { ...r, hora_dato: archivo.updatedAt, duplicadas: archivo.duplicadas },
    };
  } catch (e) {
    const msg = e instanceof ErrorFormato ? `Formato inesperado: ${e.message}` : `Error: ${(e as Error).message ?? e}`;
    return await fallo(respuesta.status, msg);
  }
}
