// Edge Function de Supabase. La llaman:
//   * pg_cron cada 5 min si toca consultar algún mercado → recorre TSM y AHledger
//     y solo descarga los que la base de datos dice que tocan;
//   * pg_cron cada 5 min si hay objetos sin ficha en el catálogo → {"tarea": "catalogo"}
//     completa un lote de ≈150 objetos desde AHledger;
//   * pg_cron cada hora si alguna profesión lleva ~1 día sin descargar → {"tarea": "recetas"};
//   * pg_cron cada hora si el archivo regional de TSM lleva ~1 día sin importar → {"tarea": "region"};
//   * el botón «Actualizar» de la página.
// Llamarla de más no provoca consultas extra a los proveedores.

import postgres from "npm:postgres@3.4.9";
import { actualizarRecetas, actualizarRegion, completarCatalogo, ejecutarTodos, type Db } from "./nucleo.ts";

// SUPABASE_DB_URL la inyecta Supabase automáticamente; nunca sale del servidor.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });
const db: Db = { consulta: (q, p) => sql.unsafe(q, p as never[]) as unknown as Promise<Record<string, unknown>[]> };

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }
  try {
    const cuerpo = await req.json().catch(() => ({})) as { tarea?: string };
    const resultado = cuerpo?.tarea === "catalogo"
      ? { catalogo: await completarCatalogo(db, { fetch }) }
      : cuerpo?.tarea === "recetas"
        ? { recetas: await actualizarRecetas(db, { fetch }) }
        : cuerpo?.tarea === "region"
          ? { region: await actualizarRegion(db, { fetch }) }
          : await ejecutarTodos(db, { fetch });
    console.log(JSON.stringify(resultado));
    return Response.json(resultado);
  } catch (e) {
    console.error("Fallo inesperado:", e);
    return Response.json({ estado: "error", detalle: { mensaje: String(e) } }, { status: 500 });
  }
});
