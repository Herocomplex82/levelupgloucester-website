// functions/api/admin/manage.js
import { isAuthorized } from "../../../lib/auth.js";
import { requireFields } from "../../../lib/validate.js";
import { insertBasket, insertWorkshopDay } from "../../../lib/db.js";

export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (body.kind === "basket") {
    const missing = requireFields(body, ["name", "description", "image_path"]);
    if (missing.length > 0) {
      return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
    const result = await insertBasket(env.DB, body);
    return Response.json(result);
  }

  if (body.kind === "workshop_day") {
    const missing = requireFields(body, [
      "title",
      "eventDate",
      "location",
      "priceFullCents",
      "priceHalfCents",
      "capacity",
    ]);
    if (missing.length > 0) {
      return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
    const result = await insertWorkshopDay(env.DB, body);
    return Response.json(result);
  }

  return Response.json({ error: "kind must be basket or workshop_day" }, { status: 400 });
}
