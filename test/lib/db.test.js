// test/lib/db.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  getActiveBaskets,
  insertBasket,
  insertWorkshopDay,
  reserveSeat,
  getWorkshopDayById,
} from "../../lib/db.js";

describe("baskets", () => {
  it("insertBasket then getActiveBaskets returns it", async () => {
    await insertBasket(env.DB, {
      name: "Catan Night",
      description: "Settlers of Catan + expansions",
      image_path: "images/baskets/catan.jpg",
    });
    const baskets = await getActiveBaskets(env.DB);
    expect(baskets.some((b) => b.name === "Catan Night")).toBe(true);
  });
});

describe("reserveSeat", () => {
  it("reserves a seat when capacity allows", async () => {
    const { id } = await insertWorkshopDay(env.DB, {
      title: "February Vacation Workshop",
      eventDate: "2027-02-17",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 1,
    });

    const reserved = await reserveSeat(env.DB, id);
    expect(reserved).toBe(true);

    const day = await getWorkshopDayById(env.DB, id);
    expect(day.seats_taken).toBe(1);
  });

  it("refuses to reserve past capacity", async () => {
    const { id } = await insertWorkshopDay(env.DB, {
      title: "Full Workshop",
      eventDate: "2027-04-21",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 1,
    });

    const first = await reserveSeat(env.DB, id);
    const second = await reserveSeat(env.DB, id);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const day = await getWorkshopDayById(env.DB, id);
    expect(day.seats_taken).toBe(1);
  });
});
