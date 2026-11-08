import { api } from "../lib/netlify.ts";

export default (req: Request) => api.importar(req);

export const config = { path: "/api/importar" };
