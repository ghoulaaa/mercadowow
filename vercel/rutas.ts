// Reparto de /api/* para Vercel. En Netlify cada ruta es una función; en Vercel (plan Hobby, máximo
// 12 funciones) una sola función las atiende todas. La lógica es la misma: netlify/lib/api.ts.

type Manejador = (req: Request, ip: string) => Response | Promise<Response>;
export type Api = Record<string, Manejador>;

// ruta pública → método de la API (los mismos nombres que netlify/functions/*.ts).
export const RUTAS: Record<string, string> = {
  actualizar: "actualizar", ajustes: "ajustes", catalogo: "catalogo", categorias: "categorias",
  cobertura: "cobertura", "compra-npc": "compraNpc", demo: "demo", estado: "estado", explicacion: "explicacion",
  favorito: "favorito", "historial-fuente": "historialFuente", historial: "historial",
  importar: "importar", inventario: "inventario", login: "login", logout: "logout", mapa: "mapa",
  mercado: "mercado", objeto: "objeto", "perfil-subasta": "perfilSubasta", precios: "precios",
  recetas: "recetas", tasas: "tasas", ventas: "ventas", version: "version",
};

const PARAM = "__ruta";

const json = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Vercel puede entregar la URL original (/api/mercado) o la reescrita (/api?__ruta=mercado): valen las dos.
export function rutaDe(url: URL): string {
  const m = url.pathname.match(/^\/api\/([a-z-]+)\/?$/);
  if (m && m[1] !== "index") return m[1];
  return url.searchParams.get(PARAM) ?? "";
}

export const ipDe = (req: Request) =>
  req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "desconocida";

export async function despachar(req: Request, api: Api): Promise<Response> {
  const url = new URL(req.url);
  const ruta = rutaDe(url);
  const metodo = Object.hasOwn(RUTAS, ruta) ? RUTAS[ruta] : null;
  if (!metodo || typeof api[metodo] !== "function") return json(404, { error: "No existe esa ruta" });

  // Los manejadores no deben ver el parámetro interno de la reescritura.
  let limpio = req;
  if (url.searchParams.has(PARAM)) {
    url.searchParams.delete(PARAM);
    url.pathname = `/api/${ruta}`;
    limpio = new Request(url, req);
  }
  return api[metodo](limpio, ipDe(req));
}
