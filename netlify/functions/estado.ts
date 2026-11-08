import { api } from "../lib/netlify.ts";

export default (req: Request) => api.estado(req);

export const config = { path: "/api/estado" };
