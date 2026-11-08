import { api } from "../lib/netlify.ts";

export default (req: Request) => api.inventario(req);

export const config = { path: "/api/inventario" };
