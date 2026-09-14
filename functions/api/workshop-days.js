import { getUpcomingWorkshopDays } from "../../lib/db.js";

export async function onRequestGet({ env }) {
  const days = await getUpcomingWorkshopDays(env.DB);
  return Response.json(days);
}
