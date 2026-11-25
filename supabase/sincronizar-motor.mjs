// Copia el motor de cálculo de la página (app/static) a la Edge Function, que solo empaqueta su propia carpeta.
// Uso: npm run motor. Con --comprobar no escribe: falla si alguna copia no coincide (lo usa la prueba).
// Así el Crafting Sniper del servidor calcula exactamente lo mismo que ve la página.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

export const ARCHIVOS = ["sniper.js", "tarjeta.js", "informe.js", "fabricacion_tabla.js", "fabricacion.js", "oportunidades.js", "moneda.js"];
const raiz = new URL("../", import.meta.url);
const origen = (f) => new URL(`app/static/${f}`, raiz);
const destino = (f) => new URL(`supabase/functions/actualizar-mercado/motor/${f}`, raiz);
const leer = (u) => { try { return readFileSync(u, "utf8").replace(/\r\n/g, "\n"); } catch { return null; } };

/** Archivos cuya copia no coincide con el original. */
export const distintos = () => ARCHIVOS.filter((f) => leer(origen(f)) !== leer(destino(f)));

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  if (process.argv.includes("--comprobar")) {
    const d = distintos();
    if (d.length) { console.error(`Motor desactualizado en la Edge Function: ${d.join(", ")}. Ejecuta npm run motor.`); process.exit(1); }
    console.log("Motor de la Edge Function al día.");
  } else {
    mkdirSync(new URL("supabase/functions/actualizar-mercado/motor/", raiz), { recursive: true });
    for (const f of ARCHIVOS) writeFileSync(destino(f), leer(origen(f)));
    console.log(`Copiados a la Edge Function: ${ARCHIVOS.join(", ")}`);
  }
}
