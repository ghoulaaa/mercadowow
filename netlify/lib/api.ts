// API de la página web en Netlify. Sin dependencias de Netlify para poder probarla
// en Node con PGlite. Las credenciales (DATABASE_URL, CLAVE_ACCESO) solo existen aquí,
// en el servidor; el navegador recibe únicamente una cookie de sesión firmada.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export interface Db {
  consulta(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

export interface OpcionesApi {
  clave: string | undefined;   // CLAVE_ACCESO
  mercado: string;
  proyecto: string;            // ref del proyecto Supabase (solo informativo)
  ahora?: () => Date;
  segura?: boolean;            // cookie Secure (true en Netlify, false en pruebas locales)
}

export const CLAVE_MINIMA = 12;
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
    json(500, { error: `Falta CLAVE_ACCESO en Netlify (mínimo ${CLAVE_MINIMA} caracteres).` });

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
      // Por defecto, el mercado real configurado. Se puede pedir otro (demo, importación) por ?mercado=.
      const mercado = new URL(req.url).searchParams.get("mercado") || o.mercado;
      try {
        const r = await llamar(db, "select estado_mercado($1) as r", [mercado]);
        if (!r) return json(404, { error: `Mercado ${mercado} no registrado` });
        const mercados = await llamar(db, "select listar_mercados() as r", []);
        return json(200, {
          ...r,
          mercados,
          mercado_principal: o.mercado,
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
      try {
        const r = await llamar(db, "select solicitar_actualizacion($1) as r", [o.mercado]);
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
