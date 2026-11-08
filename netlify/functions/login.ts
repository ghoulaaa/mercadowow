import { api, ipDe } from "../lib/netlify.ts";

export default (req: Request, context: { ip?: string }) => api.login(req, ipDe(req, context));

export const config = { path: "/api/login" };
