// test/lib/db.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  getActiveBaskets,
  insertBasket,
  insertWorkshopDay,
  reserveSeat,
  releaseSeat,
  getWorkshopDayById,
  insertRaffleEntry,
  insertDonation,
  listRaffleEntries,
  listDonations,
  insertPendingRegistration,
  confirmRegistration,
  expireRegistration,
  getRegistrationById,
} from "../../lib/db.js";

function pendingRegistrationFixture(overrides = {}) {
  return {
    childName: "Alex Rossi",
    childDob: "2018-05-01",
    parentName: "Steve Rossi",
    address: "1 Main St, Gloucester, MA",
    phone: "978-555-0100",
    email: "parent@example.com",
    emergencyContactName: "Jackie Rossi",
    emergencyContactPhone: "978-555-0101",
    allergiesMedical: "",
    waiverAccepted: true,
    waiverSignatureName: "Steve Rossi",
    waiverTimestamp: new Date().toISOString(),
    photoRelease: true,
    registrationType: "full",
    promoCodeUsed: null,
    ...overrides,
  };
}

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

describe("confirmRegistration", () => {
  it("stores the discounted amount and promo code when a promo code was applied", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "June Workshop",
      eventDate: "2027-06-01",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 5,
    });
    await reserveSeat(env.DB, workshopDayId);
    const { id } = await insertPendingRegistration(env.DB, pendingRegistrationFixture({ workshopDayId }));

    await confirmRegistration(env.DB, id, {
      stripeSessionId: "cs_test_promo_1",
      amountPaidCents: 3900, // sliding-scale discount off the $65 full price
      promoCodeUsed: "SLIDING20",
    });

    const registration = await getRegistrationById(env.DB, id);
    expect(registration.status).toBe("confirmed");
    expect(registration.amount_paid_cents).toBe(3900);
    expect(registration.promo_code_used).toBe("SLIDING20");
  });

  it("stores the full price and a null promo code when no promo code was applied", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "July Workshop",
      eventDate: "2027-07-01",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 5,
    });
    await reserveSeat(env.DB, workshopDayId);
    const { id } = await insertPendingRegistration(env.DB, pendingRegistrationFixture({ workshopDayId }));

    await confirmRegistration(env.DB, id, {
      stripeSessionId: "cs_test_no_promo_1",
      amountPaidCents: 6500,
      promoCodeUsed: null,
    });

    const registration = await getRegistrationById(env.DB, id);
    expect(registration.status).toBe("confirmed");
    expect(registration.amount_paid_cents).toBe(6500);
    expect(registration.promo_code_used).toBeNull();
  });
});

describe("expireRegistration", () => {
  it("marks a pending registration as expired", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "August Workshop",
      eventDate: "2027-08-01",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 5,
    });
    await reserveSeat(env.DB, workshopDayId);
    const { id } = await insertPendingRegistration(env.DB, pendingRegistrationFixture({ workshopDayId }));

    await expireRegistration(env.DB, id);

    const registration = await getRegistrationById(env.DB, id);
    expect(registration.status).toBe("expired");
  });

  it("does not touch a registration that is already confirmed", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "September Workshop",
      eventDate: "2027-09-01",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 5,
    });
    await reserveSeat(env.DB, workshopDayId);
    const { id } = await insertPendingRegistration(env.DB, pendingRegistrationFixture({ workshopDayId }));
    await confirmRegistration(env.DB, id, { stripeSessionId: "cs_test_already_confirmed", amountPaidCents: 6500 });

    await expireRegistration(env.DB, id);

    const registration = await getRegistrationById(env.DB, id);
    expect(registration.status).toBe("confirmed");
  });
});

describe("releaseSeat used for expired registrations", () => {
  it("frees a seat that was reserved by an abandoned checkout", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "October Workshop",
      eventDate: "2027-10-01",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 1,
    });
    await reserveSeat(env.DB, workshopDayId);

    const day = await getWorkshopDayById(env.DB, workshopDayId);
    expect(day.seats_taken).toBe(1);

    await releaseSeat(env.DB, workshopDayId);

    const dayAfter = await getWorkshopDayById(env.DB, workshopDayId);
    expect(dayAfter.seats_taken).toBe(0);
  });
});
