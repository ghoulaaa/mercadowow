import { api } from "../lib/netlify.ts";

export default (req: Request) => api.tasas(req);

export const config = { path: "/api/tasas" };
