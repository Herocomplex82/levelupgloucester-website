// test/lib/db.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  getActiveBaskets,
  insertBasket,
  insertWorkshopDay,
  reserveSeat,
  getWorkshopDayById,
  insertRaffleEntry,
  insertDonation,
  listRaffleEntries,
  listDonations,
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

describe("insertRaffleEntry idempotency", () => {
  it("ignores a duplicate insert with the same stripe_session_id", async () => {
    const { id: basketId } = await insertBasket(env.DB, {
      name: "Ticket to Ride Bundle",
      description: "Ticket to Ride + expansions",
      image_path: "images/baskets/ttr.jpg",
    });

    const entry = {
      basketId,
      donorName: "Jamie Walker",
      donorEmail: "jamie@example.com",
      ticketCount: 6,
      entryMethod: "paid",
      stripeSessionId: "cs_test_dup_raffle",
    };

    await insertRaffleEntry(env.DB, entry);
    await insertRaffleEntry(env.DB, entry);

    const entries = await listRaffleEntries(env.DB, { basketId });
    expect(entries).toHaveLength(1);
  });
});

describe("insertDonation idempotency", () => {
  it("ignores a duplicate insert with the same stripe_session_id", async () => {
    const donation = {
      donorName: "Anonymous",
      donorEmail: "donor@example.com",
      amountCents: 4000,
      designation: "sponsor_a_child",
      stripeSessionId: "cs_test_dup_donation",
    };

    await insertDonation(env.DB, donation);
    await insertDonation(env.DB, donation);

    const all = await listDonations(env.DB);
    const matching = all.filter((d) => d.stripe_session_id === "cs_test_dup_donation");
    expect(matching).toHaveLength(1);
  });
});
