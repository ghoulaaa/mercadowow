import { api } from "../lib/netlify.ts";

export default (req: Request) => api.objeto(req);

export const config = { path: "/api/objeto" };