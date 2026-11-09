import { api } from "../lib/netlify.ts";

export default (req: Request) => api.mapa(req);

export const config = { path: "/api/mapa" };
