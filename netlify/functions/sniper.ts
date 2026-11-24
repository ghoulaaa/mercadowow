import { api } from "../lib/netlify.ts";

export default (req: Request) => api.sniper(req);

export const config = { path: "/api/sniper" };
