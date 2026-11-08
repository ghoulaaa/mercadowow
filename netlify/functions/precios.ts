import { api } from "../lib/netlify.ts";

export default (req: Request) => api.precios(req);

export const config = { path: "/api/precios" };
