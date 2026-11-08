// Netlify Function: GET /api/estado (solo lectura).
// Variables de entorno en Netlify: DATABASE_URL (secreta), SUPABASE_URL, MERCADO.
// La conexión va dentro de una transacción "read only": esta función no puede escribir.

import postgres from "postgres";
import { leerEstado, refDeProyecto } from "../lib/estado.ts";

const MERCADO = process.env.MERCADO || "tsm:forever:us:pvp-horde";

export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Método no permitido", { status: 405 });
  const url = process.env.DATABASE_URL;
  if (!url) return Response.json({ error: "Falta DATABASE_URL en Netlify" }, { status: 503 });

  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5 });
  try {
    const estado = await sql.begin("read only", (tx) =>
      leerEstado(
        { consulta: (q, p) => tx.unsafe(q, (p ?? []) as never[]) as unknown as Promise<Record<string, unknown>[]> },
        MERCADO,
        refDeProyecto(process.env.SUPABASE_URL ?? ""),
      ),
    );
    // 60 s en la CDN de Netlify: muchas visitas = una sola consulta a Supabase por minuto.
    return Response.json(estado, {
      headers: { "Cache-Control": "public, max-age=30", "Netlify-CDN-Cache-Control": "public, max-age=60" },
    });
  } catch (e) {
    console.error("Fallo al leer el estado:", e);
    return Response.json(
      { error: "No se pudo conectar con Supabase", detalle: (e as Error)?.name ?? "Error" },
      { status: 503 },
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
};

export const config = { path: "/api/estado" };
