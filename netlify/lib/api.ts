// API de la página web en Netlify. Sin dependencias de Netlify para poder probarla
// en Node con PGlite. Las credenciales (DATABASE_URL, CLAVE_ACCESO) solo existen aquí,
// en el servidor; el navegador recibe únicamente una cookie de sesión firmada.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { pedirObjetoAhledger } from "../../supabase/functions/actualizar-mercado/nucleo.ts";

export interface Db {
  consulta(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

export interface OpcionesApi {
  clave: string | undefined;   // CLAVE_ACCESO
  mercado: string;
  proyecto: string;            // ref del proyecto Supabase (solo informativo)
  ahora?: () => Date;
  segura?: boolean;            // cookie Secure (true en Netlify, false en pruebas locales)
  fetch?: typeof fetch;        // para pedir a AHledger un objeto que aún no está en el catálogo
}

export const CLAVE_MINIMA = 12;
export const RANGOS = ["24h", "7d", "30d", "90d"];

export class ErrorFuente extends Error {}

/**
 * Historial de un objeto en AHledger (/v1/prices/{mercado}/{id}?range=…). Documentado:
 * 24 h y 7 días por horas, 30 y 90 días por días. Se pasa tal cual (mínimo, mediana,
 * unidades), sin rellenar huecos. Exige citar la fuente.
 */
export async function historialAhledger(f: typeof fetch, urlTabla: string, id: number, rango: string) {
  const mercado = urlTabla.match(/\/pricetable\/([a-z0-9.]+)$/)?.[1];
  if (!mercado) throw new ErrorFuente("Mercado de AHledger mal configurado");
  let r: Response;
  try {
    r = await f(`https://api.ahledger.com/v1/prices/${mercado}/${id}?range=${rango}`, {
      headers: { "User-Agent": "mercadowow/0.1 (uso personal)", Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ErrorFuente(`No se pudo consultar AHledger: ${(e as Error).message ?? e}`);
  }
  if (r.status === 404) return vacio();
  if (!r.ok) throw new ErrorFuente(`AHledger respondió HTTP ${r.status}`);
  const j = await r.json() as any;
  if (j?.market !== mercado) throw new ErrorFuente("AHledger devolvió otro mercado");
  const serie = Array.isArray(j.series) ? j.series : [];
  const t = (s: any) => Date.parse(s.t);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const l = j.latest;
  return {
    fuente: "ahledger", rango, paso_ms: rango === "24h" || rango === "7d" ? 3600e3 : 86400e3,
    nombres: ["Compra mínima", "Mediana"],
    puntos: serie.filter((s: any) => !Number.isNaN(t(s))).map((s: any) => [t(s), n(s.min), n(s.median)]),
    cantidad: serie.filter((s: any) => !Number.isNaN(t(s))).map((s: any) => [t(s), n(s.quantity)]),
    med7: null, med30: null,
    ultimo: l ? {
      hora: l.observedAt ?? null, precio: n(l.minBuyout), mediana: n(l.median), cantidad: n(l.quantity),
      subastas: n(l.auctions), mediana7d: n(l.median7d), mediana30d: n(l.median30d), mediana90d: n(l.median90d),
      origen: typeof l.source === "string" ? l.source : null,
    } : null,
    ventas: j.sales && typeof j.sales.estimatedPerDay === "number"
      ? { por_dia: j.sales.estimatedPerDay, dias: j.sales.windowDays ?? null } : null,
    atribucion: { texto: "Prices from AHledger", url: "https://ahledger.com" },
    nota: null,
  };
  function vacio() {
    return { fuente: "ahledger", rango, paso_ms: null, nombres: ["Compra mínima", "Mediana"], puntos: [], cantidad: [],
      med7: null, med30: null, ultimo: null, ventas: null, atribucion: { texto: "Prices from AHledger", url: "https://ahledger.com" }, nota: null };
  }
}
const COOKIE = "mw_sesion";
const DURACION_S = 30 * 24 * 3600;

const json = (status: number, cuerpo: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });

const b64url = (b: Buffer) => b.toString("base64url");

function firmar(clave: string, carga: string): string {
  return b64url(createHmac("sha256", "mercadowow-sesion:" + clave).update(carga).digest());
}

export function crearToken(clave: string, ahora: Date): string {
  const exp = Math.floor(ahora.getTime() / 1000) + DURACION_S;
  const carga = `v1.${exp}`;
  return `${carga}.${firmar(clave, carga)}`;
}

export function tokenValido(clave: string, token: string | null, ahora: Date): boolean {
  if (!token) return false;
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== "v1" || !/^\d+$/.test(partes[1])) return false;
  if (Number(partes[1]) * 1000 <= ahora.getTime()) return false;
  const esperado = Buffer.from(firmar(clave, `v1.${partes[1]}`));
  const recibido = Buffer.from(partes[2]);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

function claveCorrecta(clave: string, intento: string): boolean {
  const a = createHash("sha256").update(clave).digest();
  const b = createHash("sha256").update(intento).digest();
  return timingSafeEqual(a, b);
}

function leerCookie(req: Request, nombre: string): string | null {
  const cab = req.headers.get("cookie") ?? "";
  for (const parte of cab.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=");
  }
  return null;
}

async function llamar(db: Db, sql: string, params: unknown[]): Promise<any> {
  const filas = await db.consulta(sql, params);
  const r = filas[0]?.r;
  return typeof r === "string" ? JSON.parse(r) : r;
}

export function crearApi(db: Db, o: OpcionesApi) {
  const ahora = o.ahora ?? (() => new Date());
  const segura = o.segura ?? true;
  const configurada = typeof o.clave === "string" && o.clave.length >= CLAVE_MINIMA;

  const sinConfigurar = () =>
    json(500, {
      error: typeof o.clave === "string" && o.clave.length > 0
        ? `CLAVE_ACCESO es demasiado corta: necesita al menos ${CLAVE_MINIMA} caracteres. Cámbiala en las variables de entorno del alojamiento y vuelve a desplegar.`
        : `Falta CLAVE_ACCESO en las variables de entorno del alojamiento (mínimo ${CLAVE_MINIMA} caracteres). Añádela para el entorno de producción y vuelve a desplegar.`,
    });

  const autenticado = (req: Request) => configurada && tokenValido(o.clave!, leerCookie(req, COOKIE), ahora());

  const cookie = (valor: string, maxAge: number) =>
    `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${segura ? "; Secure" : ""}`;

  const fallaBd = (e: unknown) => {
    const msg = String((e as Error)?.message ?? e);
    const codigo = (e as { code?: string })?.code;
    // Errores de validación lanzados a propósito por las funciones SQL (raise exception).
    if (codigo === "P0001") return json(422, { error: msg });
    // 42883 = función inexistente, 42P01 = tabla inexistente: falta aplicar una migración.
    if (codigo === "42883" || codigo === "42P01") {
      return json(503, { error: "Faltan migraciones en Supabase: ejecuta configurar.bat" });
    }
    console.error("Error de base de datos:", msg);
    return json(503, { error: "No se pudo conectar con Supabase" });
  };

  const historialPropio = async (mercado: string, id: number, rango: string) => {
    const dias = { "24h": 1, "7d": 7, "30d": 30, "90d": 60 }[rango]!;
    const h = await llamar(db, "select historial_objeto($1, $2::integer, $3::integer) as r", [mercado, id, dias]);
    // Unidades de los escaneos guardados (las mismas que la tabla del Mercado); null si la fuente no las publica.
    const cant = await llamar(db, "select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from p.hour) * 1000)::bigint, p.quantity) order by p.hour), '[]'::jsonb) as r from price_hourly p join markets m on m.id = p.market_id where m.key = $1 and p.item_id = $2::integer and p.quantity is not null and p.hour > now() - make_interval(days => $3::integer)", [mercado, id, dias]);
    return {
      fuente: "propio", rango, paso_ms: null, nombres: ["Compra mínima", "Valor de mercado"],
      puntos: h?.puntos ?? [], cantidad: cant?.length ? cant : null, med7: h?.med7 ?? null, med30: h?.med30 ?? null, ultimo: null,
      nota: rango === "90d" ? "El historial propio se guarda como máximo 60 días." : null,
    };
  };

  /** Pide a AHledger un objeto que falta en el catálogo y lo guarda. Solo para mercados reales. */
  const altaPorId = async (mercado: string, id: number): Promise<boolean> => {
    const m = (await db.consulta("select game_type, is_demo from markets where key = $1", [mercado]))[0];
    if (!m || m.is_demo) return false;
    const r = await pedirObjetoAhledger(o.fetch ?? fetch, id, String(m.game_type));
    if (r.tipo !== "ok") return false;
    await db.consulta("select guardar_catalogo($1, $2::text::jsonb, 'ahledger', $3::timestamptz) as r",
      [m.game_type, JSON.stringify([r.objeto]), ahora().toISOString()]);
    return true;
  };

  const leerJson = async (req: Request, maxBytes: number): Promise<any> => {
    const largo = Number(req.headers.get("content-length") ?? 0);
    if (largo > maxBytes) throw new RangeError("demasiado grande");
    const texto = await req.text();
    if (texto.length > maxBytes) throw new RangeError("demasiado grande");
    return JSON.parse(texto);
  };

  return {
    async login(req: Request, ip: string): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      let intento = "";
      try {
        const cuerpo = await req.json();
        intento = typeof cuerpo?.clave === "string" ? cuerpo.clave : "";
      } catch {
        return json(400, { error: "Petición mal formada" });
      }
      try {
        const bloqueado = (await db.consulta("select login_bloqueado($1, $2::timestamptz) as b",
          [ip, ahora().toISOString()]))[0]?.b;
        if (bloqueado) {
          return json(429, { error: "Demasiados intentos fallidos. Espera 15 minutos." });
        }
        const ok = intento.length > 0 && claveCorrecta(o.clave!, intento);
        await db.consulta("select registrar_login($1, $2, $3::timestamptz)", [ip, ok, ahora().toISOString()]);
        if (!ok) return json(401, { error: "Contraseña incorrecta" });
      } catch (e) {
        return fallaBd(e);
      }
      return json(200, { ok: true }, { "Set-Cookie": cookie(crearToken(o.clave!, ahora()), DURACION_S) });
    },

    async logout(_req: Request): Promise<Response> {
      return json(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
    },

    async estado(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      // Por defecto, el mercado principal guardado en la base de datos (TSM desde 0020); si no hay,
      // el de la configuración. Se puede pedir otro (AHledger, demo, importación) por ?mercado=.
      let mercado = new URL(req.url).searchParams.get("mercado") || "";
      try {
        // Sin la migración 0020 la función no existe: se usa el mercado de la configuración.
        const principal = (await db.consulta("select mercado_principal() as m", [])
          .then((f) => f[0]?.m as string | null).catch(() => null)) || o.mercado;
        if (!mercado) mercado = principal;
        const r = await llamar(db, "select estado_mercado($1) as r", [mercado]);
        if (!r) return json(404, { error: `Mercado ${mercado} no registrado` });
        const mercados = await llamar(db, "select listar_mercados() as r", []);
        return json(200, {
          ...r,
          mercados,
          mercado_principal: principal,
          autenticado: true,
          base_de_datos: { proveedor: "Supabase", proyecto: o.proyecto, migraciones_pendientes: [] },
        });
      } catch (e) {
        return fallaBd(e);
      }
    },

    async importar(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let c: any;
      try {
        c = await leerJson(req, 5_000_000);
      } catch (e) {
        return json(e instanceof RangeError ? 413 : 400,
          { error: e instanceof RangeError ? "Archivo demasiado grande (máx. 5 MB)" : "Petición mal formada" });
      }
      if (typeof c?.mercado !== "string" || typeof c?.hora_dato !== "string" || !Array.isArray(c?.filas)) {
        return json(400, { error: "Faltan mercado, hora_dato o filas" });
      }
      try {
        const r = await llamar(db,
          "select importar_precios($1, $2::timestamptz, $3::text::jsonb, $4, $5::timestamptz) as r",
          [c.mercado, c.hora_dato, JSON.stringify(c.filas), String(c.nombre_archivo ?? "sin nombre"),
            ahora().toISOString()]);
        return json(200, r);
      } catch (e) {
        return fallaBd(e);
      }
    },

    async precios(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        const v = await llamar(db, "select version_mercado($1) as r", [mercado]);
        if (!v) return json(404, { error: `Mercado ${mercado} no registrado` });
        // Recalcula solo si hay datos o ajustes nuevos (si no, responde «al_dia» al instante).
        const motor = await llamar(db, "select recalcular_recomendaciones($1) as r", [mercado]);
        const objetos = await llamar(db, "select tabla_precios($1) as r", [mercado]);
        const resumen = await llamar(db, "select resumen_recomendaciones($1) as r", [mercado]);
        return json(200, { mercado, version: v, motor, resumen, objetos });
      } catch (e) {
        return fallaBd(e);
      }
    },

    async version(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        const v = await llamar(db, "select version_mercado($1) as r", [mercado]);
        return v ? json(200, v) : json(404, { error: `Mercado ${mercado} no registrado` });
      } catch (e) {
        return fallaBd(e);
      }
    },

    async explicacion(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      try {
        await llamar(db, "select recalcular_recomendaciones($1) as r", [mercado]);
        const r = await llamar(db, "select explicar_objeto($1, $2::integer) as r", [mercado, id]);
        return r ? json(200, r) : json(404, { error: "Objeto sin recomendación en este mercado" });
      } catch (e) {
        return fallaBd(e);
      }
    },

    async ajustes(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") return json(200, await llamar(db, "select leer_ajustes() as r", []));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c: any;
        try { c = await leerJson(req, 5000); } catch { return json(400, { error: "Petición mal formada" }); }
        if (!c || typeof c !== "object" || Array.isArray(c)) return json(400, { error: "Se esperaba un objeto" });
        return json(200, await llamar(db, "select guardar_ajustes($1::text::jsonb) as r", [JSON.stringify(c)]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    async historial(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      const dias = Number(u.get("dias") ?? 30);
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      if (!Number.isInteger(dias) || dias < 1 || dias > 60) return json(400, { error: "dias debe estar entre 1 y 60" });
      try {
        return json(200, await llamar(db, "select historial_objeto($1, $2::integer, $3::integer) as r", [mercado, id, dias]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    async inventario(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      if (req.method === "GET") {
        const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
        try {
          await llamar(db, "select recalcular_recomendaciones($1) as r", [mercado]);
          return json(200, await llamar(db, "select inventario_valorado($1) as r", [mercado]));
        } catch (e) {
          return fallaBd(e);
        }
      }
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      let c: any;
      try { c = await leerJson(req, 2_000_000); } catch { return json(400, { error: "Petición mal formada" }); }
      const entero = (v: unknown) => Number.isInteger(v);
      const costeOk = (v: unknown) => v === null || v === undefined || entero(v);
      if (typeof c?.mercado !== "string") return json(400, { error: "Falta mercado" });
      try {
        switch (c.accion) {
          case "agregar":
            if (!entero(c.item_id) || !entero(c.cantidad) || !costeOk(c.coste)) return json(400, { error: "Datos del lote no válidos" });
            return json(200, await llamar(db, "select agregar_inventario($1, $2::integer, $3::integer, $4::bigint, $5) as r",
              [c.mercado, c.item_id, c.cantidad, c.coste ?? null, c.nota ?? null]));
          case "editar":
            if (!entero(c.id) || !entero(c.cantidad) || !costeOk(c.coste)) return json(400, { error: "Datos del lote no válidos" });
            return json(200, await llamar(db, "select editar_inventario($1, $2::bigint, $3::integer, $4::bigint, $5) as r",
              [c.mercado, c.id, c.cantidad, c.coste ?? null, c.nota ?? null]));
          case "borrar":
            if (!entero(c.id)) return json(400, { error: "Falta id" });
            return json(200, await llamar(db, "select borrar_inventario($1, $2::bigint) as r", [c.mercado, c.id]));
          case "importar":
            if (!Array.isArray(c.filas)) return json(400, { error: "Faltan filas" });
            return json(200, await llamar(db, "select importar_inventario($1, $2::text::jsonb, $3::boolean) as r",
              [c.mercado, JSON.stringify(c.filas), c.reemplazar === true]));
          default:
            return json(400, { error: "Acción desconocida" });
        }
      } catch (e) {
        return fallaBd(e);
      }
    },

    async ventas(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      if (req.method === "GET") {
        const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
        try {
          await llamar(db, "select recalcular_recomendaciones($1) as r", [mercado]);   // registra el día si falta
          const lista = await llamar(db, "select ventas_listado($1, $2::timestamptz) as r", [mercado, ahora().toISOString()]);
          const evaluacion = await llamar(db, "select evaluar_recomendaciones($1, $2::timestamptz) as r", [mercado, ahora().toISOString()]);
          return json(200, { ...lista, evaluacion });
        } catch (e) {
          return fallaBd(e);
        }
      }
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      let c: any;
      try { c = await leerJson(req, 5000); } catch { return json(400, { error: "Petición mal formada" }); }
      const entero = (v: unknown) => Number.isInteger(v);
      const opcional = (v: unknown) => v === null || v === undefined || entero(v);
      if (typeof c?.mercado !== "string") return json(400, { error: "Falta mercado" });
      try {
        if (c.accion === "registrar") {
          if (!entero(c.item_id) || !entero(c.cantidad) || !entero(c.precio) || typeof c.vendido_en !== "string"
              || !opcional(c.comision) || !opcional(c.deposito) || !opcional(c.lote_id)) {
            return json(400, { error: "Datos de la venta no válidos" });
          }
          return json(200, await llamar(db,
            `select registrar_venta($1, $2::integer, $3::integer, $4::bigint, $5::timestamptz, $6::bigint, $7::bigint,
                                    $8::bigint, $9::boolean, $10, $11::timestamptz) as r`,
            [c.mercado, c.item_id, c.cantidad, c.precio, c.vendido_en, c.comision ?? null, c.deposito ?? null,
              c.lote_id ?? null, c.descontar === true, c.nota ?? null, ahora().toISOString()]));
        }
        if (c.accion === "borrar") {
          if (!entero(c.id)) return json(400, { error: "Falta id" });
          return json(200, await llamar(db, "select borrar_venta($1, $2::bigint) as r", [c.mercado, c.id]));
        }
        return json(400, { error: "Acción desconocida" });
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Historial para el gráfico: de AHledger (24 h, 7, 30 y 90 días) o, en otros mercados, el propio. */
    async historialFuente(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      const rango = u.get("rango") ?? "7d";
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      if (!RANGOS.includes(rango)) return json(400, { error: `rango debe ser ${RANGOS.join(", ")}` });
      try {
        const m = (await db.consulta("select provider, source_url from markets where key = $1", [mercado]))[0];
        if (!m) return json(404, { error: `Mercado ${mercado} no registrado` });
        // guardado=1: los escaneos guardados en la base de datos (p. ej. las unidades de la pestaña «Precios»),
        // en vez del historial que publica AHledger en su servicio.
        return json(200, m.provider === "ahledger" && u.get("guardado") !== "1"
          ? await historialAhledger(o.fetch ?? fetch, String(m.source_url), id, rango)
          : await historialPropio(mercado, id, rango));
      } catch (e) {
        if (e instanceof ErrorFuente) return json(502, { error: e.message });
        return fallaBd(e);
      }
    },

    async catalogo(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const q = (u.get("q") ?? "").trim().slice(0, 80);
      if (!q) return json(200, { q, resultados: [] });
      try {
        let resultados = await llamar(db, "select buscar_catalogo($1, $2, 20) as r", [mercado, q]);
        // Un ID que no está en el catálogo: se pide a AHledger y se añade (alta por ID).
        if (/^\d{1,9}$/.test(q) && !resultados.some((r: any) => r.id === Number(q))) {
          const anadido = await altaPorId(mercado, Number(q));
          if (anadido) resultados = await llamar(db, "select buscar_catalogo($1, $2, 20) as r", [mercado, q]);
        }
        return json(200, { q, resultados });
      } catch (e) {
        return fallaBd(e);
      }
    },

    async objeto(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      if (!Number.isInteger(id) || id <= 0) return json(400, { error: "Falta id" });
      try {
        let f = await llamar(db, "select ficha_objeto($1, $2::integer) as r", [mercado, id]);
        if (!f?.en_catalogo && await altaPorId(mercado, id)) {
          f = await llamar(db, "select ficha_objeto($1, $2::integer) as r", [mercado, id]);
        }
        return f ? json(200, f) : json(404, { error: "Ese objeto no existe en el catálogo ni en AHledger" });
      } catch (e) {
        return fallaBd(e);
      }
    },

    async categorias(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        return json(200, await llamar(db, "select categorias_mercado($1) as r", [mercado]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Cobertura del catálogo (GET) e importación verificable de IDs (POST {ids: number[]}). */
    async cobertura(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") {
          const informe = new URL(req.url).searchParams.get("informe") === "1";
          return json(200, await llamar(db, informe ? "select informe_catalogo('forever') as r" : "select cobertura_catalogo('forever') as r", []));
        }
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c: any;
        try { c = await leerJson(req, 100_000); } catch { return json(400, { error: "Petición mal formada" }); }
        if (!Array.isArray(c?.ids) || !c.ids.length || c.ids.length > 5000 || !c.ids.every((x: unknown) => Number.isInteger(x) && Math.abs(x as number) < 2 ** 31)) {
          return json(400, { error: "ids debe ser una lista de 1 a 5000 números enteros" });
        }
        return json(200, await llamar(db, "select solicitar_catalogo('forever', $1::integer[], $2::timestamptz) as r",
          [c.ids, ahora().toISOString()]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Banda de precios para «Qué hacer con este objeto» (X1): leer (GET) y guardar (POST {ajustes}). */
    async perfilSubasta(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") return json(200, await llamar(db, "select leer_perfil_subasta() as r", []));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c: any;
        try { c = await leerJson(req, 2000); } catch { return json(400, { error: "Petición mal formada" }); }
        if (!c?.ajustes || typeof c.ajustes !== "object" || Array.isArray(c.ajustes)) return json(400, { error: "Faltan los ajustes" });
        return json(200, await llamar(db, "select guardar_perfil_subasta($1::text::jsonb) as r", [JSON.stringify(c.ajustes)]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Mapa de materiales (W3): variación por periodo, agrupada por familia. */
    async mapa(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      // ambito=casa (X5): toda la casa por clase › subclase › objetos; si no, materiales por familia.
      const casa = u.get("ambito") === "casa";
      if (!["casa", "materiales", null].includes(u.get("ambito"))) return json(400, { error: "ambito debe ser materiales o casa" });
      const p: Record<string, string> = {};
      for (const k of casa ? ["periodo", "clase", "subclase", "calidad", "solo_ofertas"]
                           : ["periodo", "profesion", "familia", "calidad", "solo_ofertas"]) {
        const v = u.get(k);
        if (v !== null && v !== "") p[k] = v.slice(0, 80);
      }
      if (p.solo_ofertas !== undefined && !["true", "false"].includes(p.solo_ofertas)) {
        return json(400, { error: "solo_ofertas debe ser true o false" });
      }
      try {
        return json(200, await llamar(db, `select ${casa ? "mapa_casa" : "mapa_materiales"}($1, $2::text::jsonb) as r`,
          [mercado, JSON.stringify(p)]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Tabla del Mercado paginada sobre todo el catálogo (V2): filtros, orden y página en la base de datos. */
    async mercado(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const p: Record<string, string> = {};
      for (const k of ["q", "categoria", "subcategoria", "calidad", "profesion", "rol", "materiales", "familia",
                       "nivel_min", "nivel_max", "precio_min", "precio_max", "solo_ofertas", "oportunidad",
                       "ventas_region_min", "lista", "orden", "dir", "pagina", "por_pagina"]) {
        const v = u.get(k);
        if (v !== null && v !== "") p[k] = v.slice(0, 80);
      }
      for (const k of ["solo_ofertas", "materiales"]) {
        if (p[k] !== undefined && !["true", "false"].includes(p[k])) return json(400, { error: `${k} debe ser true o false` });
      }
      try {
        return json(200, await llamar(db, "select mercado_pagina($1, $2::text::jsonb) as r", [mercado, JSON.stringify(p)]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Recetas (R5): ?profesion=X → lista con coste; ?objeto=ID → fabricación y usos; nada → profesiones. */
    async recetas(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const base = u.get("base") || "mediana";
      if (!["mediana", "minimo", "tsm"].includes(base)) return json(400, { error: "base debe ser mediana, minimo o tsm" });
      const profesion = u.get("profesion");
      const objeto = u.get("objeto");
      try {
        if (objeto !== null) {
          const id = Number(objeto);
          if (!Number.isInteger(id) || id <= 0) return json(400, { error: "objeto no válido" });
          return json(200, await llamar(db, "select recetas_objeto($1, $2::integer, $3) as r", [mercado, id, base]));
        }
        if (profesion !== null) {
          return json(200, await llamar(db, "select recetas_profesion($1, $2, $3) as r", [mercado, profesion.slice(0, 40), base]));
        }
        return json(200, await llamar(db, "select profesiones_recetas($1) as r", [mercado]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /**
     * Precios de compra al NPC introducidos por ti (X4). GET: lista. POST {filas: [{id, precio}], aplicar}:
     * comprueba cada fila (vista previa) y, con aplicar = true, guarda las aceptadas.
     */
    async compraNpc(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        if (req.method === "GET") return json(200, await llamar(db, "select listar_compra_npc($1) as r", [mercado]));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c: any;
        try { c = await leerJson(req, 200_000); } catch { return json(400, { error: "Petición mal formada" }); }
        if (!Array.isArray(c?.filas) || typeof c?.aplicar !== "boolean") return json(400, { error: "Faltan filas o aplicar" });
        if (c.filas.length > 2000) return json(400, { error: "Máximo 2000 filas por importación" });
        return json(200, await llamar(db, "select importar_compra_npc($1, $2::text::jsonb, $3::boolean, $4::timestamptz) as r",
          [mercado, JSON.stringify(c.filas), c.aplicar, ahora().toISOString()]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Ficha oficial de un objeto (texto del juego en español, de Blizzard) para el cuadro del icono. */
    async tooltip(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      const id = Number(u.get("id"));
      if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return json(400, { error: "id no válido" });
      try {
        return json(200, { ficha: await llamar(db, "select ficha_blizzard($1, $2::integer) as r", [mercado, id]) });
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Nombres oficiales en español ({id: nombre}) y cuántos hay (API de Blizzard). */
    async nombresEs(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        return json(200, await llamar(db, "select nombres_es($1) as r", [mercado]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Listas propias (X6). GET ?objeto=ID: listas (y si lo contienen). POST {accion, …}: gestionar. */
    async listas(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") {
          const obj = new URL(req.url).searchParams.get("objeto");
          const id = obj === null || obj === "" ? null : Number(obj);
          if (id !== null && (!Number.isInteger(id) || id <= 0)) return json(400, { error: "objeto no válido" });
          return json(200, await llamar(db, "select listar_listas($1::integer) as r", [id]));
        }
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c: any;
        try { c = await leerJson(req, 5000); } catch { return json(400, { error: "Petición mal formada" }); }
        if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.accion !== "string") return json(400, { error: "Falta accion" });
        return json(200, await llamar(db, "select gestionar_lista($1::text::jsonb) as r", [JSON.stringify(c)]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Alertas por umbral (X6). GET ?mercado&objeto: alertas y avisos. POST {accion, …}: crear, borrar, visto. */
    async alertas(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      const u = new URL(req.url).searchParams;
      const mercado = u.get("mercado") || o.mercado;
      try {
        if (req.method === "GET") {
          const obj = u.get("objeto");
          const id = obj === null || obj === "" ? null : Number(obj);
          if (id !== null && (!Number.isInteger(id) || id <= 0)) return json(400, { error: "objeto no válido" });
          return json(200, await llamar(db, "select leer_alertas($1, $2::integer) as r", [mercado, id]));
        }
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c: any;
        try { c = await leerJson(req, 20_000); } catch { return json(400, { error: "Petición mal formada" }); }
        if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.accion !== "string") return json(400, { error: "Falta accion" });
        return json(200, await llamar(db, "select gestionar_alerta($1, $2::text::jsonb) as r", [mercado, JSON.stringify(c)]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    /** Reglas de comisión y depósito (auction_fee_rules): leer y editar. */
    async tasas(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      try {
        if (req.method === "GET") return json(200, await llamar(db, "select leer_tasas('forever') as r", []));
        if (req.method !== "POST") return json(405, { error: "Método no permitido" });
        let c: any;
        try { c = await leerJson(req, 2000); } catch { return json(400, { error: "Petición mal formada" }); }
        if (!Number.isInteger(c?.id) || !c?.cambios || typeof c.cambios !== "object" || Array.isArray(c.cambios)) {
          return json(400, { error: "Faltan id o cambios" });
        }
        return json(200, await llamar(db, "select guardar_tasa($1::smallint, $2::text::jsonb, $3::date) as r",
          [c.id, JSON.stringify(c.cambios), ahora().toISOString().slice(0, 10)]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    async favorito(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let c: any;
      try {
        c = await leerJson(req, 1000);
      } catch {
        return json(400, { error: "Petición mal formada" });
      }
      if (typeof c?.mercado !== "string" || !Number.isInteger(c?.id) || typeof c?.favorito !== "boolean") {
        return json(400, { error: "Faltan mercado, id o favorito" });
      }
      try {
        return json(200, await llamar(db, "select marcar_favorito($1, $2::integer, $3::boolean) as r",
          [c.mercado, c.id, c.favorito]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    async demo(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let dias = 30;
      try {
        const c = await leerJson(req, 1000);
        if (c?.dias !== undefined) dias = Number(c.dias);
      } catch { /* cuerpo vacío: 30 días */ }
      if (!Number.isInteger(dias) || dias < 1 || dias > 60) return json(400, { error: "dias debe estar entre 1 y 60" });
      try {
        return json(200, await llamar(db, "select generar_demo($1::integer, $2::timestamptz) as r",
          [dias, ahora().toISOString()]));
      } catch (e) {
        return fallaBd(e);
      }
    },

    async actualizar(req: Request): Promise<Response> {
      if (!configurada) return sinConfigurar();
      if (req.method !== "POST") return json(405, { error: "Método no permitido" });
      if (!autenticado(req)) return json(401, { error: "no_autenticado" });
      let mercado = o.mercado;
      try {
        const c = await leerJson(req, 1000);
        if (typeof c?.mercado === "string" && c.mercado.length <= 100) mercado = c.mercado;
      } catch { /* sin cuerpo: el mercado principal */ }
      try {
        const r = await llamar(db, "select solicitar_actualizacion($1) as r", [mercado]);
        if (!r?.ok) {
          const mensajes: Record<string, string> = {
            en_curso: "Ya hay una actualización en curso.",
            espera: `Espera ${r?.segundos ?? 0} s antes de volver a pedirla.`,
            mercado_sin_fuente: "Este mercado no tiene descarga automática.",
          };
          return json(r?.motivo === "espera" ? 429 : 409,
            { ...r, mensaje: mensajes[r?.motivo] ?? "No disponible" });
        }
        // Dispara la Edge Function desde Postgres (pg_net, asíncrono): no hace esperar a la página.
        await db.consulta("select disparar_si_corresponde()", []);
        return json(202, { ok: true, mensaje: "Actualización solicitada." });
      } catch (e) {
        return fallaBd(e);
      }
    },
  };
}
