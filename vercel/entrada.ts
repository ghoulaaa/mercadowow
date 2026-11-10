// Punto de entrada de la función de Vercel. No se despliega tal cual: `npm run vercel` lo empaqueta
// en api/index.js (con sus dependencias), que es el archivo que Vercel ejecuta.

import { api } from "../netlify/lib/netlify.ts";
import { despachar, type Api } from "./rutas.ts";

const atender = (req: Request) => despachar(req, api as unknown as Api);

export const GET = atender;
export const POST = atender;
export const PUT = atender;
export const PATCH = atender;
export const DELETE = atender;
export const HEAD = atender;
export const OPTIONS = atender;
