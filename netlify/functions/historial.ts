import { api } from "../lib/netlify.ts";

export default (req: Request) => api.historial(req);

export const config = { path: "/api/historial" };
