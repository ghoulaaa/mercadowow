import { api } from "../lib/netlify.ts";

export default (req: Request) => api.recetas(req);

export const config = { path: "/api/recetas" };
