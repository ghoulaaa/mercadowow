import { api } from "../lib/netlify.ts";

export default (req: Request) => api.compraNpc(req);

export const config = { path: "/api/compra-npc" };
