import { api } from "../lib/netlify.ts";

export default (req: Request) => api.demo(req);

export const config = { path: "/api/demo" };
