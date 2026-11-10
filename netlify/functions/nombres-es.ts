import { api } from "../lib/netlify.ts";

export default (req: Request) => api.nombresEs(req);

export const config = { path: "/api/nombres-es" };
