import { api } from "../lib/netlify.ts";

export default (req: Request) => api.historialFuente(req);

export const config = { path: "/api/historial-fuente" };
