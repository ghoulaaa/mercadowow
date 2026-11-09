import { api } from "../lib/netlify.ts";

export default (req: Request) => api.cobertura(req);

export const config = { path: "/api/cobertura" };
