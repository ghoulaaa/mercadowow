// Empaqueta vercel/entrada.ts en api/index.js. Uso: npm run vercel
// Con --comprobar no escribe: falla si api/index.js no coincide con el código actual.

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const raiz = new URL("../", import.meta.url);
const destino = new URL("api/index.js", raiz);

export async function empaquetar() {
  const r = await build({
    absWorkingDir: decodeURIComponent(raiz.pathname).replace(/^\/([A-Za-z]:)/, "$1"),
    entryPoints: ["vercel/entrada.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false,
    legalComments: "none",
    charset: "utf8",
    banner: { js: "// GENERADO por `npm run vercel` a partir de vercel/entrada.ts. No editar a mano." },
  });
  return r.outputFiles[0].text.replace(/\r\n/g, "\n");
}

export const actual = () => {
  try { return readFileSync(destino, "utf8").replace(/\r\n/g, "\n"); } catch { return null; }
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const texto = await empaquetar();
  if (process.argv.includes("--comprobar")) {
    if (actual() !== texto) { console.error("api/index.js está desactualizado: ejecuta `npm run vercel`"); process.exit(1); }
    console.log("api/index.js está al día");
  } else {
    mkdirSync(new URL("api/", raiz), { recursive: true });
    writeFileSync(destino, texto);
    console.log(`api/index.js escrito (${Math.round(texto.length / 1024)} KB)`);
  }
}
