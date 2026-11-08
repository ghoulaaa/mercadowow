import { api } from "../lib/netlify.ts";

export default (req: Request) => api.actualizar(req);

export const config = { path: "/api/actualizar" };
