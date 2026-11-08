import { api } from "../lib/netlify.ts";

export default (req: Request) => api.catalogo(req);

export const config = { path: "/api/catalogo" };