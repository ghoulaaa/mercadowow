import { api } from "../lib/netlify.ts";

export default (req: Request) => api.listas(req);

export const config = { path: "/api/listas" };
