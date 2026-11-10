import { api } from "../lib/netlify.ts";

export default (req: Request) => api.perfilSubasta(req);

export const config = { path: "/api/perfil-subasta" };
