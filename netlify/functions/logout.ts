import { api } from "../lib/netlify.ts";

export default (req: Request) => api.logout(req);

export const config = { path: "/api/logout" };
