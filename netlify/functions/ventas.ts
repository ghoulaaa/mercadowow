import { api } from "../lib/netlify.ts";

export default (req: Request) => api.ventas(req);

export const config = { path: "/api/ventas" };
