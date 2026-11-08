import { api } from "../lib/netlify.ts";

export default (req: Request) => api.version(req);

export const config = { path: "/api/version" };
