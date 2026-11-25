// Tarea «tarjeta» de la Edge Function: convierte en PNG la tarjeta del Crafting Sniper (motor/tarjeta.js, el
// mismo dibujo que la vista previa de la página) con resvg. Va en su propia petición para que cada tarjeta
// tenga su propio tiempo de CPU; solo la acepta con el token interno del sniper (sniper_token()).
//
// resvg (WebAssembly) y la fuente Inter se descargan de jsDelivr en versiones fijas y se comprueba su SHA-256
// antes de usarlos; quedan en memoria mientras la función siga caliente. Los iconos solo se aceptan de
// render.worldofwarcraft.com (el CDN de Blizzard del catálogo) y también se guardan en memoria.

import { Resvg, initWasm } from "npm:@resvg/resvg-wasm@2.6.2";
import { ANCHO_BASE, iconosDe, tarjetaSVG } from "./motor/tarjeta.js";
import { ICONO_RESPALDO } from "./motor/sniper.js";
import { ICONO_PERMITIDO, iconosInforme, informeSVG } from "./motor/informe.js";

const CDN = "https://cdn.jsdelivr.net/npm/";
const WASM = { url: `${CDN}@resvg/resvg-wasm@2.6.2/index_bg.wasm`, sha: "22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70" };
const FUENTES = [
  ["400Regular/Inter_400Regular.ttf", "a414b48aa577ef2c62ebb135341ddeef33ee26a4f5dc9f787f93c1aab08ebb50"],
  ["500Medium/Inter_500Medium.ttf", "f1738576525e86db1d5cf63a6c1b56e0a7e2a2898b499ac93db95f2e7a9f9cd5"],
  ["600SemiBold/Inter_600SemiBold.ttf", "f30e9d2574c3bec5144347ff965f9841c8f06857f0b7383000f8c9489a161841"],
  ["700Bold/Inter_700Bold.ttf", "fbe825cbfc749317f57a1433d3905aa9d3f388732fd29b8e8a36f34845e3bc3e"],
  ["800ExtraBold/Inter_800ExtraBold.ttf", "1b9fab96ffc7bca31a9d4cd4d660cce80b94695908ec7613afdece2b8cf803c2"],
].map(([f, sha]) => ({ url: `${CDN}@expo-google-fonts/inter@0.4.2/${f}`, sha }))
  // Títulos del informe diario.
  .concat([{ url: `${CDN}@expo-google-fonts/cinzel@0.4.2/700Bold/Cinzel_700Bold.ttf`, sha: "f606ab3a8a0a75863022676ea496478bb0f4d520ae8c40b6050df3d6dbffad20" }]);

async function descargarVerificado({ url, sha }: { url: string; sha: string }): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar ${url.split("/").pop()} (${r.status})`);
  const b = new Uint8Array(await r.arrayBuffer());
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (h !== sha) throw new Error(`${url.split("/").pop()} no coincide con su huella SHA-256`);
  return b;
}

let preparado: Promise<Uint8Array[]> | null = null;
/** wasm iniciado y fuentes cargadas (una vez por instancia). */
function preparar(): Promise<Uint8Array[]> {
  preparado ??= (async () => {
    const [wasm, ...fuentes] = await Promise.all([descargarVerificado(WASM), ...FUENTES.map(descargarVerificado)]);
    await initWasm(wasm);
    return fuentes;
  })().catch((e) => { preparado = null; throw e; });
  return preparado;
}

const ICONOS = new Map<string, string>();       // url → data:image/jpeg;base64,…
const ICONO_VALIDO = ICONO_PERMITIDO;
async function icono(url: string): Promise<string | null> {
  if (!ICONO_VALIDO.test(url)) return null;
  const guardado = ICONOS.get(url);
  if (guardado) return guardado;
  try {
    const r = await fetch(url);
    const tipo = r.headers.get("content-type") ?? "";
    if (!r.ok || !/^image\/(jpeg|png)/.test(tipo)) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length > 200_000) return null;
    let bin = "";
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    const dato = `data:${tipo.split(";")[0]};base64,${btoa(bin)}`;
    if (ICONOS.size > 500) ICONOS.clear();
    ICONOS.set(url, dato);
    return dato;
  } catch { return null; }
}

/** PNG de la tarjeta de una oportunidad. */
export async function dibujarTarjeta(o: any, opciones: any): Promise<Uint8Array> {
  const fuentes = await preparar();
  const iconos: Record<string, string> = {};
  const respaldo = await icono(ICONO_RESPALDO);
  await Promise.all(iconosDe(o, opciones.apariencia).map(async (u: string) => {
    const d = (await icono(u)) ?? respaldo;
    if (d) iconos[u] = d;
  }));
  if (respaldo) iconos[ICONO_RESPALDO] = respaldo;
  const { svg } = tarjetaSVG(o, { ...opciones, iconos });
  const ancho = [800, 1000, 1200].includes(Number(opciones.apariencia?.ancho)) ? Number(opciones.apariencia.ancho) : ANCHO_BASE;
  const r = new Resvg(svg, { fitTo: { mode: "width", value: ancho },
                             font: { fontBuffers: fuentes, defaultFontFamily: "Inter", loadSystemFonts: false } });
  const png = r.render().asPng();
  r.free();
  return png;
}

/** Ancho del PNG de cada página del informe diario (el dibujo mide 800 × 600: a 1200 px, 1,5 veces más nítido). */
export const ANCHO_PNG_INFORME = 1200;

/** PNG de una página del informe diario a partir de sus datos guardados (informes.datos). */
export async function dibujarInforme(datos: any, sitio = "", pagina = "resumen"): Promise<Uint8Array> {
  const fuentes = await preparar();
  const iconos: Record<string, string> = {};
  const respaldo = await icono(ICONO_RESPALDO);
  await Promise.all(iconosInforme(datos).map(async (u: string) => {
    const d = (await icono(u)) ?? respaldo;
    if (d) iconos[u] = d;
  }));
  if (respaldo) iconos[ICONO_RESPALDO] = respaldo;
  const { svg } = informeSVG(datos, { iconos, sitio, pagina });
  const r = new Resvg(svg, { fitTo: { mode: "width", value: ANCHO_PNG_INFORME },
                             font: { fontBuffers: fuentes, defaultFontFamily: "Inter", loadSystemFonts: false } });
  const png = r.render().asPng();
  r.free();
  return png;
}