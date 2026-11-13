import { api } from "../lib/netlify.ts";

export default (req: Request) => api.tooltip(req);

export const config = { path: "/api/tooltip" };
