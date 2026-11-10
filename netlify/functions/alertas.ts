import { api } from "../lib/netlify.ts";

export default (req: Request) => api.alertas(req);

export const config = { path: "/api/alertas" };
