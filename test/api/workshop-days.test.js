import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { insertWorkshopDay } from "../../lib/db.js";
import { onRequestGet } from "../../functions/api/workshop-days.js";

describe("GET /api/workshop-days", () => {
  it("returns upcoming workshop days with seatsRemaining", async () => {
    await insertWorkshopDay(env.DB, {
      title: "February Vacation Workshop",
      eventDate: "2027-02-17",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 20,
    });

    const response = await onRequestGet({ env });
    expect(response.status).toBe(200);
    const body = await response.json();
    const day = body.find((d) => d.title === "February Vacation Workshop");
    expect(day.seatsRemaining).toBe(20);
  });
});
