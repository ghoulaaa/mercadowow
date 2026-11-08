// Conexión compartida por las funciones de Netlify. Variables (en Netlify → Environment variables):
//   DATABASE_URL  cadena «Session pooler» de Supabase (secreta)
//   SUPABASE_URL  https://xxxx.supabase.co
//   CLAVE_ACCESO  contraseña para entrar a la página (mínimo 12 caracteres, secreta)
//   MERCADO       opcional, por defecto tsm:forever:us:pvp-horde

import postgres from "postgres";
import { crearApi, type Db } from "./api.ts";

let sql: ReturnType<typeof postgres> | null = null;

const db: Db = {
  consulta(q, p) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL en Netlify");
    // Una conexión por instancia; se cierra sola si queda inactiva.
    sql ??= postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 15, prepare: false });
    return sql.unsafe(q, p as never[]) as unknown as Promise<Record<string, unknown>[]>;
  },
};

const proyecto = (process.env.SUPABASE_URL ?? "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "?";

export const api = crearApi(db, {
  clave: process.env.CLAVE_ACCESO,
  mercado: process.env.MERCADO ?? "ahledger:forever:us:pvp-horde",
  proyecto,
});

export const ipDe = (req: Request, context: { ip?: string }) =>
  context?.ip ?? req.headers.get("x-nf-client-connection-ip") ?? "desconocida";
