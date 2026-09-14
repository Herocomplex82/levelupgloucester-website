import { getActiveBaskets } from "../../lib/db.js";

export async function onRequestGet({ env }) {
  const baskets = await getActiveBaskets(env.DB);
  return Response.json(baskets);
}
