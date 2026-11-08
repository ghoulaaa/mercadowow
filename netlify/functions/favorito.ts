import { api } from "../lib/netlify.ts";

export default (req: Request) => api.favorito(req);

export const config = { path: "/api/favorito" };
