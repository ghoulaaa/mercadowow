// Edge Function de Supabase: la llama pg_cron (cada 5 min comprueba si toca)
// y el botón manual. Recorre todos los mercados con descarga automática (TSM y
// AHledger) y solo descarga los que la base de datos dice que tocan, así que
// llamarla de más no provoca consultas extra a los proveedores.

import postgres from "npm:postgres@3.4.9";
import { ejecutarTodos, type Db } from "./nucleo.ts";

// SUPABASE_DB_URL la inyecta Supabase automáticamente; nunca sale del servidor.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });
const db: Db = { consulta: (q, p) => sql.unsafe(q, p as never[]) as unknown as Promise<Record<string, unknown>[]> };

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }
  try {
    const resultados = await ejecutarTodos(db, { fetch });
    console.log(JSON.stringify(resultados));
    return Response.json(resultados);
  } catch (e) {
    console.error("Fallo inesperado:", e);
    return Response.json({ estado: "error", detalle: { mensaje: String(e) } }, { status: 500 });
  }
});
