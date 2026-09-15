// functions/api/admin/manage.js
import { isAuthorized } from "../../../lib/auth.js";
import { requireFields } from "../../../lib/validate.js";
import { insertBasket, insertWorkshopDay, updateBasketArv, updateWorkshopDayImage } from "../../../lib/db.js";

export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.kind === "basket") {
    const missing = requireFields(body, ["name", "description", "image_path"]);
    if (missing.length > 0) {
      return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
    if (body.arv_cents != null && (!Number.isInteger(body.arv_cents) || body.arv_cents < 0)) {
      return Response.json({ error: "arv_cents must be a non-negative integer" }, { status: 400 });
    }
    const result = await insertBasket(env.DB, body);
    return Response.json(result);
  }

  if (body.kind === "basket_arv") {
    const missing = requireFields(body, ["id", "arv_cents"]);
    if (missing.length > 0) {
      return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
    if (!Number.isInteger(body.arv_cents) || body.arv_cents < 0) {
      return Response.json({ error: "arv_cents must be a non-negative integer" }, { status: 400 });
    }
    await updateBasketArv(env.DB, body);
    return Response.json({ ok: true });
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
    if (!Number.isInteger(body.capacity) || body.capacity < 0) {
      return Response.json({ error: "capacity must be a non-negative integer" }, { status: 400 });
    }
    if (!Number.isInteger(body.priceFullCents) || body.priceFullCents < 0) {
      return Response.json({ error: "priceFullCents must be a non-negative integer" }, { status: 400 });
    }
    if (!Number.isInteger(body.priceHalfCents) || body.priceHalfCents < 0) {
      return Response.json({ error: "priceHalfCents must be a non-negative integer" }, { status: 400 });
    }
    const result = await insertWorkshopDay(env.DB, body);
    return Response.json(result);
  }

  if (body.kind === "workshop_day_image") {
    const missing = requireFields(body, ["id", "image_path"]);
    if (missing.length > 0) {
      return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
    await updateWorkshopDayImage(env.DB, body);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "kind must be basket, basket_arv, workshop_day, or workshop_day_image" }, { status: 400 });
}
