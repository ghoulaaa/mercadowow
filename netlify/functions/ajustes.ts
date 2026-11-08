import { api } from "../lib/netlify.ts";

export default (req: Request) => api.ajustes(req);

export const config = { path: "/api/ajustes" };
