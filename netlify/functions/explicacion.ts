import { api } from "../lib/netlify.ts";

export default (req: Request) => api.explicacion(req);

export const config = { path: "/api/explicacion" };
