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
    // TSM escribe 0 cuando no hay dato (p. ej. minBuyout = 0: ningún anuncio en ese escaneo).
    // Ninguna subasta cuesta 0 cobres: se guarda como null («sin dato»), nunca como precio 0.
    const sinCero = (n: number | null) => (n === 0 ? null : n);
    porItem.set(itemId, {
      item_id: itemId,
      name: r[1],
      market_value: sinCero(cobre(r[2], "marketValue", linea)),
      min_buyout: sinCero(cobre(r[3], "minBuyout", linea)),
      recent: sinCero(cobre(r[4], "recent", linea)),
      historical: sinCero(cobre(r[5], "historical", linea)),
    });
  }

  if (updatedAt === null) throw new ErrorFormato("El archivo no tiene filas de datos");
  return { filas: [...porItem.values()], updatedAt, duplicadas: total - porItem.size };
}

// ---------------------------------------------------------------------
// AHledger: tabla de precios en texto (formato AHL1), documentada en ahledger.com/developers.
//   Cabecera: AHL1|forever/pvp/horde/us|<unix>|<filas>
//   Fila:     id:mediana:mínimo:cantidad:mediana7d:mediana30d:mínimo30d:máximo30d:ventas_día×10
//   Campo vacío = desconocido. Precios en cobre.

export interface FilaAhledger {
  item_id: number;
  name?: string;
  min_buyout: number | null;
  market_value: number | null;   // = mediana (lo más parecido al «valor de mercado»)
  historical: number | null;     // = mediana de 30 días según AHledger
  recent: null;
  median: number | null;
  quantity: number | null;
  auctions: null;                // la tabla no lo trae
  sales_per_day: number | null;  // ESTIMACIÓN de AHledger (no son ventas confirmadas)
}

export const esAhledger = (mercado: string) => mercado.startsWith("ahledger:");

/** «ahledger:forever:us:pvp-horde» → «forever/pvp/horde/us» (como lo escribe la cabecera). */
export function slugAhledger(mercado: string): string {
  const [, juego, region, slug] = mercado.split(":");
  return `${juego}/${slug.replace("-", "/")}/${region}`;
}

export function leerTablaAhledger(texto: string, slugEsperado: string): ArchivoTsm & { filas: FilaAhledger[] } {
  const lineas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lineas.length) throw new ErrorFormato("Tabla vacía");
  const cab = lineas[0].split("|");
  if (cab.length !== 4 || cab[0] !== "AHL1") {
    throw new ErrorFormato(`Cabecera inesperada: ${JSON.stringify(lineas[0].slice(0, 80))}`);
  }
  // Separación de mercados: la tabla debe ser EXACTAMENTE del mercado pedido.
  if (cab[1] !== slugEsperado) {
    throw new ErrorFormato(`La tabla es del mercado ${cab[1]}, no de ${slugEsperado}`);
  }
  if (!/^\d+$/.test(cab[2]) || !/^\d+$/.test(cab[3])) throw new ErrorFormato("Cabecera con hora o filas no válidas");
  const declaradas = Number(cab[3]);
  if (lineas.length - 1 !== declaradas) {
    throw new ErrorFormato(`La cabecera anuncia ${declaradas} filas y llegaron ${lineas.length - 1} (¿descarga cortada?)`);
  }
  const ent = (v: string, campo: string, n: number) => {
    if (v === "") return null;
    if (!/^\d+$/.test(v)) throw new ErrorFormato(`Fila ${n}: ${campo}=${JSON.stringify(v)} no es un entero`);
    const x = Number(v);
    if (!Number.isSafeInteger(x)) throw new ErrorFormato(`Fila ${n}: ${campo} demasiado grande`);
    return x;
  };
  const porItem = new Map<number, FilaAhledger>();
  for (let k = 1; k < lineas.length; k++) {
    const c = lineas[k].split(":");
    if (c.length !== 9) throw new ErrorFormato(`Fila ${k + 1}: ${c.length} campos en vez de 9`);
    const id = ent(c[0], "id", k + 1);
    if (!id || id > 2_147_483_647) throw new ErrorFormato(`Fila ${k + 1}: id no válido`);
    const ventas10 = ent(c[8], "ventas", k + 1);
    const mediana = ent(c[1], "mediana", k + 1);
    porItem.set(id, {
      item_id: id,
      median: mediana,
      market_value: mediana,
      min_buyout: ent(c[2], "mínimo", k + 1),
      quantity: ent(c[3], "cantidad", k + 1),
      historical: ent(c[5], "mediana30d", k + 1),
      recent: null,
      auctions: null,
      sales_per_day: ventas10 == null ? null : ventas10 / 10,
    });
  }
  if (!porItem.size) throw new ErrorFormato("La tabla no tiene filas de datos");
  return {
    filas: [...porItem.values()],
    updatedAt: new Date(Number(cab[2]) * 1000).toISOString(),
    duplicadas: declaradas - porItem.size,
  };
}

/**
 * Pone nombre a cada fila: los conocidos salen de la base de datos; los nuevos se piden a
 * /v1/tooltip en lotes de 100 (nombre, calidad, clase, nivel, icono) y se guardan.
 * Si AHledger no da el nombre, se usa «Objeto #id» y se reintentará en la próxima versión.
 */
async function prepararAhledger(db: Db, o: Opciones, mk: string, urlTabla: string,
                                archivo: ArchivoTsm & { filas: FilaAhledger[] }) {
  const ids = archivo.filas.map((f) => f.item_id);
  const faltan = ((await db.consulta("select objetos_sin_metadatos($1, $2::integer[]) as r", [mk, ids]))[0]?.r ?? []) as number[];
  const urlTooltip = urlTabla.replace("/pricetable/", "/tooltip/");
  const metadatos: Record<string, unknown>[] = [];
  const lotes: number[][] = [];
  for (let i = 0; i < faltan.length; i += 100) lotes.push(faltan.slice(i, i + 100));
  // Pocas peticiones a la vez, para respetar el límite de AHledger (300 por minuto).
  for (let i = 0; i < lotes.length; i += 4) {
    await Promise.all(lotes.slice(i, i + 4).map(async (lote) => {
      try {
        const r = await o.fetch(`${urlTooltip}?items=${lote.join(",")}`, {
          headers: { "User-Agent": o.userAgent ?? "mercadowow/0.1 (uso personal)" },
          signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
        });
        if (!r.ok) { await r.body?.cancel(); return; }
        const d = await r.json() as { items?: Record<string, unknown>[] };
        for (const it of d.items ?? []) {
          if (!Number.isInteger(it.id) || typeof it.name !== "string") continue;
          metadatos.push({
            item_id: it.id, name: it.name,
            quality: typeof it.quality === "string" ? it.quality : null,
            item_class: typeof it.itemClass === "string" ? it.itemClass : null,
            level: Number.isInteger(it.level) ? it.level : null,
            icon_url: typeof it.icon === "string" ? it.icon : null,
          });
        }
      } catch { /* sin nombre: se reintenta en la próxima versión */ }
    }));
  }
  const conNombre = new Set(metadatos.map((m) => m.item_id as number));
  for (const id of faltan) {
    if (!conNombre.has(id)) metadatos.push({ item_id: id, name: `Objeto #${id}`, fuente: "pendiente" });
  }
  if (metadatos.length) {
    await db.consulta("select guardar_metadatos($1, $2::text::jsonb) as r", [mk, JSON.stringify(metadatos)]);
  }
  return archivo;
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
    const archivo = esAhledger(mk)
      ? await prepararAhledger(db, o, mk, String(turno.url), leerTablaAhledger(texto, slugAhledger(mk)))
      : leerArchivoTsm(texto);
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

/** Ejecuta todos los mercados con descarga automática (TSM, AHledger…). Uno que falle no frena al resto. */
export async function ejecutarTodos(db: Db, o: Omit<Opciones, "mercado">): Promise<Record<string, Resultado>> {
  const filas = await db.consulta("select key from markets where source_url is not null order by key", []);
  const resultados: Record<string, Resultado> = {};
  for (const f of filas) {
    const mercado = String(f.key);
    try {
      resultados[mercado] = await ejecutar(db, { ...o, mercado, runId: undefined });
    } catch (e) {
      resultados[mercado] = { estado: "error", detalle: { mensaje: String((e as Error)?.message ?? e) } };
    }
  }
  return resultados;
}

// ---------------------------------------------------------------------
// Catálogo (R2): metadatos completos desde AHledger /v1/items/{id}?game=forever,
// por lotes pequeños para respetar su límite (300 peticiones por minuto).

export const URL_OBJETO_AHLEDGER = "https://api.ahledger.com/v1/items/";

export type ResultadoObjeto =
  | { tipo: "ok"; objeto: Record<string, unknown> }
  | { tipo: "no_encontrado" }
  | { tipo: "parar"; motivo: string };

/** Pide un objeto a AHledger. «parar» = límite o caída del servicio: no seguir pidiendo. */
export async function pedirObjetoAhledger(f: typeof fetch, id: number, juego = "forever",
                                          userAgent = "mercadowow/0.1 (uso personal)"): Promise<ResultadoObjeto> {
  let r: Response;
  try {
    r = await f(`${URL_OBJETO_AHLEDGER}${id}?game=${juego}`, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { tipo: "parar", motivo: `Error de conexión: ${(e as Error).message ?? e}` };
  }
  if (r.status === 404) { await r.body?.cancel(); return { tipo: "no_encontrado" }; }
  if (r.status !== 200) { await r.body?.cancel(); return { tipo: "parar", motivo: `HTTP ${r.status}` }; }
  const j = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!j || j.id !== id || typeof j.name !== "string" || !j.name.trim()) return { tipo: "no_encontrado" };
  return { tipo: "ok", objeto: j };
}

export async function completarCatalogo(db: Db, o: { fetch: typeof fetch; ahora?: () => Date; limite?: number;
                                                     simultaneas?: number }) {
  const ahora = o.ahora ?? (() => new Date());
  const t = () => ahora().toISOString();
  const turno = (await db.consulta("select tomar_turno_catalogo(180, $1::timestamptz) as r", [t()]))[0]?.r;
  if (!turno) return { estado: "omitido", motivo: "en_curso" };
  try {
    const ids = ((await db.consulta("select catalogo_pendientes('forever', $1::integer, $2::timestamptz) as r",
      [o.limite ?? 150, t()]))[0]?.r ?? []) as number[];
    const ok: Record<string, unknown>[] = [];
    const sinDatos: number[] = [];
    let parado: string | null = null;
    const n = o.simultaneas ?? 5;
    for (let i = 0; i < ids.length && !parado; i += n) {
      const res = await Promise.all(ids.slice(i, i + n).map((id) => pedirObjetoAhledger(o.fetch, id)));
      res.forEach((r, k) => {
        if (r.tipo === "ok") ok.push(r.objeto);
        else if (r.tipo === "no_encontrado") sinDatos.push(ids[i + k]);
        else parado ??= r.motivo;
      });
    }
    if (ok.length) {
      await db.consulta("select guardar_catalogo('forever', $1::text::jsonb, 'ahledger', $2::timestamptz) as r",
        [JSON.stringify(ok), t()]);
    }
    if (sinDatos.length) {
      await db.consulta("select registrar_fallo_catalogo('forever', $1::integer[], 'AHledger no tiene este objeto', $2::timestamptz)",
        [sinDatos, t()]);
    }
    return { estado: "ok", pedidos: ids.length, guardados: ok.length, sin_datos: sinDatos.length, parado };
  } finally {
    await db.consulta("select soltar_turno_catalogo()", []);
  }
}

// ---------------------------------------------------------------------
// Recetas (R5): /v1/crafting/{mercado}?profession=…&all=true, una profesión por petición,
// una vez al día. Se guarda la lista COMPLETA de cada profesión o nada.

export const PROFESIONES = ["Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid",
  "Herbalism", "Leatherworking", "Mining", "Skinning", "Tailoring"] as const;
export const LIMITE_RECETAS = 2000;

export interface Receta {
  spell_id: number; nombre: string; nivel_requerido: number | null; obtencion: string | null;
  resultado_id: number; resultado_nombre: string; resultado_calidad: string | null;
  cantidad_min: number; cantidad_max: number;
  reactivos: { item_id: number; nombre: string; cantidad: number }[];
}

const entero = (x: unknown, min: number) => Number.isInteger(x) && (x as number) >= min ? x as number : null;
const texto = (x: unknown) => typeof x === "string" && x.trim() ? x.trim() : null;

/** URL de recetas a partir de la de la tabla de precios del mercado AHledger. */
export function urlRecetas(urlTabla: string, profesion: string): string {
  const base = urlTabla.replace("/v1/pricetable/", "/v1/crafting/");
  if (base === urlTabla) throw new ErrorFormato("La URL del mercado no es de la tabla de precios de AHledger");
  return `${base}?profession=${encodeURIComponent(profesion)}&all=true&limit=${LIMITE_RECETAS}`;
}

/** Valida la respuesta y la convierte. Recetas incompletas en la fuente se descartan (y se cuentan). */
export function leerRecetasAhledger(j: any, profesion: string, mercadoEsperado: string): { recetas: Receta[]; descartadas: number } {
  if (!j || typeof j !== "object" || !Array.isArray(j.recipes)) throw new ErrorFormato("Respuesta de recetas sin lista «recipes»");
  if (j.market !== mercadoEsperado) throw new ErrorFormato(`Recetas de otro mercado (${j.market}); se esperaba ${mercadoEsperado}`);
  if (String(j.filters?.profession ?? "").toLowerCase() !== profesion.toLowerCase()) {
    throw new ErrorFormato(`Recetas de otra profesión (${j.filters?.profession})`);
  }
  // Si llegan tantas como el límite, la lista puede estar cortada: guardarla borraría recetas reales.
  if (j.recipes.length >= Number(j.filters?.limit ?? LIMITE_RECETAS)) {
    throw new ErrorFormato(`La lista de ${profesion} puede estar incompleta (${j.recipes.length} = límite)`);
  }
  const recetas: Receta[] = [];
  let descartadas = 0;
  for (const x of j.recipes) {
    const rec = x?.recipe, res = x?.result;
    const spell = entero(rec?.spellId, 1), nombre = texto(rec?.name), resId = entero(res?.id, 1);
    const qMin = entero(res?.qtyMin, 1), qMax = entero(res?.qtyMax, 1);
    const reactivos = Array.isArray(x?.reagents) ? x.reagents.map((g: any) => ({
      item_id: entero(g?.id, 1), nombre: texto(g?.name), cantidad: entero(g?.qty, 1),
    })) : [];
    const valido = spell && nombre && resId && qMin && qMax && qMax >= qMin && reactivos.length > 0
      && reactivos.every((g: any) => g.item_id && g.nombre && g.cantidad)
      && String(rec?.profession ?? "").toLowerCase() === profesion.toLowerCase();
    if (!valido) { descartadas++; continue; }
    recetas.push({
      spell_id: spell, nombre, nivel_requerido: entero(rec.skillRequired, 0), obtencion: texto(rec.acquisition),
      resultado_id: resId, resultado_nombre: texto(res.name) ?? nombre, resultado_calidad: texto(res.quality),
      cantidad_min: qMin, cantidad_max: qMax, reactivos,
    });
  }
  return { recetas, descartadas };
}

// ---------------------------------------------------------------------
// Referencia regional (X3): archivo de TODA la región de TSM, una vez al día, en su propia tabla.
// No son precios de PvP Horda: nunca se guardan en price_hourly.

export const COLUMNAS_REGION = [
  "itemId", "name", "marketValue", "historical", "avgSalePrice", "saleRate", "soldPerDay", "updatedAt",
] as const;
export const URL_REGION = "https://public-data.tradeskillmaster.com/forever/us/region/items.csv";

export interface FilaRegion {
  item_id: number; market_value: number | null; historical: number | null; avg_sale_price: number | null;
  sale_rate: number | null; sold_per_day: number | null;
}

function decimal(valor: string, columna: string, linea: number, max: number): number | null {
  if (valor === "") return null;
  if (!/^\d+(\.\d+)?$/.test(valor)) throw new ErrorFormato(`Línea ${linea}: ${columna}=${JSON.stringify(valor)} no es un número`);
  const n = Number(valor);
  if (!(n <= max)) throw new ErrorFormato(`Línea ${linea}: ${columna}=${valor} fuera de rango`);
  return n;
}

/** Valida y convierte el CSV regional de TSM. Si el formato cambia, falla en vez de guardar datos dudosos. */
export function leerArchivoRegion(texto: string): { filas: FilaRegion[]; updatedAt: string; duplicadas: number } {
  const tabla = parsearCsv(texto);
  if (tabla.length === 0) throw new ErrorFormato("Archivo vacío");
  const cabecera = tabla[0].map((c) => c.trim());
  if (cabecera.join(",") !== COLUMNAS_REGION.join(",")) {
    throw new ErrorFormato(`Columnas inesperadas: ${cabecera.join(",")} (se esperaba ${COLUMNAS_REGION.join(",")})`);
  }
  const porItem = new Map<number, FilaRegion>();
  let updatedAt: string | null = null;
  let total = 0;
  const sinCero = (n: number | null) => (n === 0 ? null : n);
  for (let k = 1; k < tabla.length; k++) {
    const linea = k + 1;
    const r = tabla[k];
    if (r.length !== COLUMNAS_REGION.length) {
      throw new ErrorFormato(`Línea ${linea}: ${r.length} columnas en vez de ${COLUMNAS_REGION.length}`);
    }
    const itemId = Number(r[0]);
    if (!/^\d+$/.test(r[0]) || itemId <= 0 || itemId > 2_147_483_647) {
      throw new ErrorFormato(`Línea ${linea}: itemId inválido ${JSON.stringify(r[0])}`);
    }
    const fecha = Date.parse(r[7]);
    if (Number.isNaN(fecha)) throw new ErrorFormato(`Línea ${linea}: updatedAt inválido ${JSON.stringify(r[7])}`);
    const iso = new Date(fecha).toISOString();
    if (updatedAt === null) updatedAt = iso;
    else if (updatedAt !== iso) throw new ErrorFormato(`Línea ${linea}: updatedAt distinto (${iso} ≠ ${updatedAt})`);
    total++;
    porItem.set(itemId, {
      item_id: itemId,
      market_value: sinCero(cobre(r[2], "marketValue", linea)),
      historical: sinCero(cobre(r[3], "historical", linea)),
      // TSM escribe 0 cuando no tiene venta media: es «sin dato», no un precio de 0.
      avg_sale_price: sinCero(cobre(r[4], "avgSalePrice", linea)),
      sale_rate: decimal(r[5], "saleRate", linea, 1),
      sold_per_day: decimal(r[6], "soldPerDay", linea, 10_000_000),
    });
  }
  if (updatedAt === null) throw new ErrorFormato("El archivo no tiene filas de datos");
  return { filas: [...porItem.values()], updatedAt, duplicadas: total - porItem.size };
}

export async function actualizarRegion(db: Db, o: { fetch: typeof fetch; ahora?: () => Date; userAgent?: string;
                                                   url?: string }) {
  const ahora = o.ahora ?? (() => new Date());
  const t = () => ahora().toISOString();
  const turno = (await db.consulta("select tomar_turno_region(300, $1::timestamptz) as r", [t()]))[0]?.r;
  if (!turno) return { estado: "omitido", motivo: "en_curso" };
  try {
    const pendiente = (await db.consulta("select region_pendiente('forever', 'us', $1::timestamptz) as r", [t()]))[0]?.r;
    if (!pendiente) return { estado: "ok", motivo: "al_dia" };
    const url = o.url ?? URL_REGION;
    let r: Response;
    try {
      r = await o.fetch(url, { headers: { "User-Agent": o.userAgent ?? "mercadowow/0.1 (uso personal)" },
                               signal: AbortSignal.timeout(30_000) });
    } catch (e) { return { estado: "error", motivo: `Error de conexión: ${(e as Error).message ?? e}` }; }
    if (r.status !== 200) { await r.body?.cancel(); return { estado: "error", motivo: `HTTP ${r.status}` }; }
    try {
      const { filas, updatedAt } = leerArchivoRegion(await r.text());
      const n = Number((await db.consulta(
        "select guardar_region('forever', 'us', $1::text::jsonb, $2::timestamptz, $3, $4::timestamptz) as r",
        [JSON.stringify(filas), updatedAt, url, t()]))[0]?.r);
      return { estado: "ok", guardadas: n, actualizado: updatedAt };
    } catch (e) {
      return { estado: "error", motivo: e instanceof ErrorFormato ? e.message : `Error: ${(e as Error).message ?? e}` };
    }
  } finally {
    await db.consulta("select soltar_turno_region()", []);
  }
}

// ---------------------------------------------------------------------
// Nombres oficiales en español: API de datos de juego de Blizzard (locale es_MX), por lotes.
// Credenciales: BLIZZARD_CLIENT_ID y BLIZZARD_CLIENT_SECRET, secretos de la Edge Function (nunca en el código).

export const URL_TOKEN_BLIZZARD = "https://oauth.battle.net/token";
export const URL_API_BLIZZARD = "https://us.api.blizzard.com";
/** Espacios de datos candidatos para Forever (se usa el primero que pase la comprobación). */
export const NAMESPACES_BLIZZARD = ["static-classic1x-us"];
export const LOCALE_ES = "es_MX";
/** Objeto de control: el espacio de datos solo vale si devuelve este ID con este nombre en inglés. */
export const CONTROL_BLIZZARD = { id: 2589, nombre_en: "Linen Cloth" };

type RespuestaItem = { tipo: "ok"; nombre: string } | { tipo: "no" } | { tipo: "error"; motivo: string }
  | { tipo: "parar"; motivo: string };

async function pedirItemBlizzard(f: typeof fetch, token: string, ns: string, locale: string, id: number): Promise<RespuestaItem> {
  let r: Response;
  try {
    r = await f(`${URL_API_BLIZZARD}/data/wow/item/${id}?namespace=${ns}&locale=${locale}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000),
    });
  } catch (e) { return { tipo: "parar", motivo: `Error de conexión: ${(e as Error).message ?? e}` }; }
  if (r.status === 404) { await r.body?.cancel(); return { tipo: "no" }; }
  // Límite de peticiones o credenciales: parar. Otro error del servidor con ESTE objeto: solo se salta.
  if (r.status === 429 || r.status === 401 || r.status === 403) {
    await r.body?.cancel(); return { tipo: "parar", motivo: `HTTP ${r.status}` };
  }
  if (r.status !== 200) { await r.body?.cancel(); return { tipo: "error", motivo: `HTTP ${r.status}` }; }
  const j = await r.json().catch(() => null) as { id?: unknown; name?: unknown } | null;
  // Con locale, la API devuelve el nombre como texto. Si no coincide el ID o no hay nombre, no se guarda nada.
  if (!j || j.id !== id || typeof j.name !== "string" || !j.name.trim()) return { tipo: "no" };
  return { tipo: "ok", nombre: j.name.trim() };
}

export async function actualizarNombresEs(db: Db, o: { fetch: typeof fetch; clientId?: string; secreto?: string;
                                                      ahora?: () => Date; lote?: number; paralelo?: number }) {
  const ahora = o.ahora ?? (() => new Date());
  const t = () => ahora().toISOString();
  const turno = (await db.consulta("select tomar_turno_nombres_es(300, $1::timestamptz) as r", [t()]))[0]?.r;
  if (!turno) return { estado: "omitido", motivo: "en_curso" };
  let pausa = 0;   // segundos que se deja el turno bloqueado al terminar (0 = libre)
  try {
    if (!o.clientId || !o.secreto) { pausa = 6 * 3600; return { estado: "omitido", motivo: "sin_credenciales" }; }
    const pendientes = ((await db.consulta("select nombres_es_pendientes('forever', $1, $2::timestamptz) as r",
      [o.lote ?? 400, t()]))[0]?.r ?? []) as number[];
    if (!pendientes.length) return { estado: "ok", motivo: "al_dia" };

    // 1. Token (credenciales de cliente).
    let token: string;
    try {
      const r = await o.fetch(URL_TOKEN_BLIZZARD, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${o.clientId}:${o.secreto}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials", signal: AbortSignal.timeout(15_000),
      });
      if (r.status === 401 || r.status === 400) { await r.body?.cancel(); pausa = 6 * 3600; return { estado: "error", motivo: "credenciales_rechazadas" }; }
      if (r.status !== 200) { await r.body?.cancel(); pausa = 900; return { estado: "error", motivo: `token: HTTP ${r.status}` }; }
      token = String((await r.json())?.access_token ?? "");
      if (!token) { pausa = 900; return { estado: "error", motivo: "token vacío" }; }
    } catch (e) { pausa = 900; return { estado: "error", motivo: `token: ${(e as Error).message ?? e}` }; }

    // 2. Espacio de datos comprobado con un objeto conocido (mismo ID y mismo nombre en inglés que el catálogo).
    let ns: string | null = null;
    for (const cand of NAMESPACES_BLIZZARD) {
      const c = await pedirItemBlizzard(o.fetch, token, cand, "en_US", CONTROL_BLIZZARD.id);
      if (c.tipo === "parar" || c.tipo === "error") { pausa = 900; return { estado: "error", motivo: c.motivo }; }
      if (c.tipo === "ok" && c.nombre === CONTROL_BLIZZARD.nombre_en) { ns = cand; break; }
    }
    if (!ns) { pausa = 24 * 3600; return { estado: "error", motivo: "ningun_espacio_de_datos_coincide" }; }

    // 3. Nombres en español, con pocas peticiones a la vez (muy por debajo del límite de la API).
    const encontrados: { id: number; nombre: string }[] = [];
    const sinNombre: number[] = [];
    const conError: number[] = [];
    let parado: string | null = null;
    let erroresSeguidos = 0;
    let k = 0;
    const trabajador = async () => {
      while (!parado && k < pendientes.length) {
        const id = pendientes[k++];
        let r = await pedirItemBlizzard(o.fetch, token, ns!, LOCALE_ES, id);
        if (r.tipo === "error") r = await pedirItemBlizzard(o.fetch, token, ns!, LOCALE_ES, id);   // un reintento
        if (r.tipo === "ok") { encontrados.push({ id, nombre: r.nombre }); erroresSeguidos = 0; }
        else if (r.tipo === "no") { sinNombre.push(id); erroresSeguidos = 0; }
        else if (r.tipo === "error") {
          conError.push(id);   // se salta: se reintenta en ~1 día
          // Muchos errores seguidos: la API está fallando en general, no un objeto concreto.
          if (++erroresSeguidos >= 10) parado = `${r.motivo} en ${erroresSeguidos} objetos seguidos`;
        } else parado = r.motivo;
      }
    };
    await Promise.all(Array.from({ length: o.paralelo ?? 5 }, trabajador));
    if (parado) pausa = 900;
    const g = (await db.consulta(
      "select guardar_nombres_es('forever', $1::text::jsonb, $2::integer[], $3, $4::timestamptz, $5::integer[]) as r",
      [JSON.stringify(encontrados), sinNombre, `blizzard:${ns}:${LOCALE_ES}`, t(), conError]))[0]?.r;
    return { estado: "ok", espacio: ns, pedidos: pendientes.length, ...(g as object), parado };
  } finally {
    await db.consulta("select soltar_turno_nombres_es($1, $2::timestamptz)", [pausa, t()]);
  }
}

export async function actualizarRecetas(db: Db, o: { fetch: typeof fetch; ahora?: () => Date;
                                                    userAgent?: string }) {
  const ahora = o.ahora ?? (() => new Date());
  const t = () => ahora().toISOString();
  const turno = (await db.consulta("select tomar_turno_recetas(300, $1::timestamptz) as r", [t()]))[0]?.r;
  if (!turno) return { estado: "omitido", motivo: "en_curso" };
  try {
    const pendientes = ((await db.consulta("select recetas_pendientes('forever', $1::timestamptz) as r", [t()]))[0]?.r
      ?? []) as string[];
    if (!pendientes.length) return { estado: "ok", motivo: "al_dia", guardadas: {} };
    const m = (await db.consulta(
      "select source_url from markets where provider = 'ahledger' and game_type = 'forever' and not is_demo order by key limit 1",
      []))[0];
    if (!m?.source_url) return { estado: "omitido", motivo: "sin_mercado_ahledger" };
    const urlTabla = String(m.source_url);
    const slug = urlTabla.split("/").pop()!;
    const guardadas: Record<string, number> = {};
    const errores: Record<string, string> = {};
    let parado: string | null = null;
    for (const p of pendientes) {
      const url = urlRecetas(urlTabla, p);
      let r: Response;
      try {
        r = await o.fetch(url, { headers: { "User-Agent": o.userAgent ?? "mercadowow/0.1 (uso personal)", Accept: "application/json" },
                                 signal: AbortSignal.timeout(30_000) });
      } catch (e) { parado = `Error de conexión: ${(e as Error).message ?? e}`; break; }
      if (r.status === 429 || r.status >= 500) { await r.body?.cancel(); parado = `HTTP ${r.status}`; break; }
      if (r.status !== 200) { await r.body?.cancel(); errores[p] = `HTTP ${r.status}`; continue; }
      try {
        const { recetas, descartadas } = leerRecetasAhledger(await r.json(), p, slug);
        if (!recetas.length) { errores[p] = "AHledger no devolvió recetas válidas"; continue; }
        guardadas[p] = Number((await db.consulta(
          "select guardar_recetas('forever', $1, $2::text::jsonb, $3, $4::timestamptz) as r",
          [p, JSON.stringify(recetas), url, t()]))[0]?.r);
        if (descartadas) errores[p] = `${descartadas} recetas incompletas en la fuente, no guardadas`;
      } catch (e) {
        errores[p] = e instanceof ErrorFormato ? e.message : `Error: ${(e as Error).message ?? e}`;
      }
    }
    return { estado: "ok", guardadas, errores, parado };
  } finally {
    await db.consulta("select soltar_turno_recetas()", []);
  }
}