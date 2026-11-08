// Edge Function de Supabase: la llama pg_cron (cada 5 min comprueba si toca)
// y el botón manual. Solo descarga si la base de datos dice que toca, así que
// llamarla de más no provoca consultas extra al proveedor.

import postgres from "npm:postgres@3.4.9";
import { ejecutar, type Db } from "./nucleo.ts";

const MERCADO = Deno.env.get("MERCADO") ?? "tsm:forever:us:pvp-horde";

// SUPABASE_DB_URL la inyecta Supabase automáticamente; nunca sale del servidor.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });
const db: Db = { consulta: (q, p) => sql.unsafe(q, p as never[]) as unknown as Promise<Record<string, unknown>[]> };

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }
  try {
    const resultado = await ejecutar(db, { mercado: MERCADO, fetch });
    console.log(JSON.stringify(resultado));
    return Response.json(resultado);
  } catch (e) {
    console.error("Fallo inesperado:", e);
    return Response.json({ estado: "error", detalle: { mensaje: String(e) } }, { status: 500 });
  }
});
