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
    if (/estado_mercado|login_bloqueado|does not exist/.test(msg)) {
      return json(503, { error: "Faltan migraciones en Supabase: ejecuta configurar.bat" });
    }
    console.error("Error de base de datos:", msg);
    return json(503, { error: "No se pudo conectar con Supabase" });
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
      try {
        const r = await llamar(db, "select estado_mercado($1) as r", [o.mercado]);
        if (!r) return json(500, { error: `Mercado ${o.mercado} no registrado` });
        return json(200, {
          ...r,
          autenticado: true,
          base_de_datos: { proveedor: "Supabase", proyecto: o.proyecto, migraciones_pendientes: [] },
        });
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
