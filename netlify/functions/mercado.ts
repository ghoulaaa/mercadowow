import { api } from "../lib/netlify.ts";

export default (req: Request) => api.mercado(req);

export const config = { path: "/api/mercado" };
