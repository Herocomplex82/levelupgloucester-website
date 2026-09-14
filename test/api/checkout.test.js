// test/api/checkout.test.js
import { describe, expect, it, vi, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { insertBasket, insertWorkshopDay, getWorkshopDayById } from "../../lib/db.js";
import * as stripeLib from "../../lib/stripe.js";
import { onRequestPost } from "../../functions/api/checkout.js";

function postJson(body) {
  return new Request("https://levelupgloucester.org/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeStripe(sessionUrl = "https://checkout.stripe.com/test-session") {
  return {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: sessionUrl, id: "cs_test_123" }),
      },
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/checkout — raffle", () => {
  it("computes 6-for-$5 pricing and returns a checkout url", async () => {
    const { id: basketId } = await insertBasket(env.DB, {
      name: "Catan Night",
      description: "Settlers of Catan + expansions",
      image_path: "images/baskets/catan.jpg",
    });
    const stripe = fakeStripe();
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "raffle",
        basketId,
        ticketCount: 6,
        donorName: "Jamie Walker",
        donorEmail: "jamie@example.com",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://checkout.stripe.com/test-session");

    const call = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(call.line_items[0].price_data.unit_amount).toBe(500); // $5.00 for 6 tickets
    expect(call.metadata.type).toBe("raffle");
    expect(call.metadata.basketId).toBe(String(basketId));
  });

  it("404s for a basket that doesn't exist", async () => {
    const stripe = fakeStripe();
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "raffle",
        basketId: 999999,
        ticketCount: 1,
        donorName: "Jamie Walker",
        donorEmail: "jamie@example.com",
      }),
    });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/checkout — registration", () => {
  it("reserves a seat, creates a pending registration, and returns a checkout url", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "February Vacation Workshop",
      eventDate: "2027-02-17",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 1,
    });
    const stripe = fakeStripe();
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "registration",
        workshopDayId,
        registrationType: "full",
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
        photoRelease: true,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://checkout.stripe.com/test-session");

    const call = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(call.line_items[0].price_data.unit_amount).toBe(6500);
    expect(call.metadata.type).toBe("registration");
    expect(call.metadata.registrationId).toBeDefined();

    const day = await getWorkshopDayById(env.DB, workshopDayId);
    expect(day.seats_taken).toBe(1);
  });

  it("409s when the workshop day is full", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "Sold Out Workshop",
      eventDate: "2027-04-21",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 0,
    });
    const stripe = fakeStripe();
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "registration",
        workshopDayId,
        registrationType: "full",
        childName: "Alex Rossi",
        childDob: "2018-05-01",
        parentName: "Steve Rossi",
        address: "1 Main St, Gloucester, MA",
        phone: "978-555-0100",
        email: "parent@example.com",
        emergencyContactName: "Jackie Rossi",
        emergencyContactPhone: "978-555-0101",
        waiverAccepted: true,
        waiverSignatureName: "Steve Rossi",
        photoRelease: false,
      }),
    });

    expect(response.status).toBe(409);
  });

  it("400s on an invalid registrationType and does not reserve a seat", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "Bad Registration Type Workshop",
      eventDate: "2027-04-23",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 5,
    });
    const stripe = fakeStripe();
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "registration",
        workshopDayId,
        registrationType: "partial",
        childName: "Alex Rossi",
        childDob: "2018-05-01",
        parentName: "Steve Rossi",
        address: "1 Main St, Gloucester, MA",
        phone: "978-555-0100",
        email: "parent@example.com",
        emergencyContactName: "Jackie Rossi",
        emergencyContactPhone: "978-555-0101",
        waiverAccepted: true,
        waiverSignatureName: "Steve Rossi",
        photoRelease: false,
      }),
    });

    expect(response.status).toBe(400);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();

    const day = await getWorkshopDayById(env.DB, workshopDayId);
    expect(day.seats_taken).toBe(0);
  });

  it("releases the seat and returns a clean 500 when Stripe fails after the seat is reserved", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "Stripe Failure Workshop",
      eventDate: "2027-04-24",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 1,
    });
    const stripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockRejectedValue(new Error("stripe_secret_key=sk_live_super_secret failure")),
        },
      },
    };
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "registration",
        workshopDayId,
        registrationType: "full",
        childName: "Alex Rossi",
        childDob: "2018-05-01",
        parentName: "Steve Rossi",
        address: "1 Main St, Gloucester, MA",
        phone: "978-555-0100",
        email: "parent@example.com",
        emergencyContactName: "Jackie Rossi",
        emergencyContactPhone: "978-555-0101",
        waiverAccepted: true,
        waiverSignatureName: "Steve Rossi",
        photoRelease: false,
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Something went wrong, please try again");
    expect(body.error).not.toMatch(/sk_live/);
    expect(JSON.stringify(body)).not.toMatch(/sk_live/);

    const day = await getWorkshopDayById(env.DB, workshopDayId);
    expect(day.seats_taken).toBe(0);
  });

  it("400s when the waiver was not accepted", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "Waiver Test Workshop",
      eventDate: "2027-04-22",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 10,
    });
    const stripe = fakeStripe();
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "registration",
        workshopDayId,
        registrationType: "full",
        childName: "Alex Rossi",
        childDob: "2018-05-01",
        parentName: "Steve Rossi",
        address: "1 Main St, Gloucester, MA",
        phone: "978-555-0100",
        email: "parent@example.com",
        emergencyContactName: "Jackie Rossi",
        emergencyContactPhone: "978-555-0101",
        waiverAccepted: false,
        waiverSignatureName: "Steve Rossi",
        photoRelease: false,
      }),
    });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/checkout — top-level error handling", () => {
  it("returns a clean 500 (not a raw exception) when a handler throws unexpectedly", async () => {
    vi.spyOn(stripeLib, "getStripeClient").mockImplementation(() => {
      throw new Error("unexpected internal failure: env.STRIPE_SECRET_KEY=sk_live_super_secret");
    });

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "donation",
        amountCents: 4000,
        designation: "sponsor_a_child",
        donorName: "Anonymous",
        donorEmail: "donor@example.com",
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Something went wrong. Please try again.");
    expect(body.error).not.toMatch(/sk_live/);
    expect(JSON.stringify(body)).not.toMatch(/sk_live/);
  });
});

describe("POST /api/checkout — donation", () => {
  it("creates a checkout session with the designation in metadata", async () => {
    const stripe = fakeStripe();
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue(stripe);

    const response = await onRequestPost({
      env,
      request: postJson({
        type: "donation",
        amountCents: 4000,
        designation: "sponsor_a_child",
        donorName: "Anonymous",
        donorEmail: "donor@example.com",
      }),
    });

    expect(response.status).toBe(200);
    const call = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(call.line_items[0].price_data.unit_amount).toBe(4000);
    expect(call.metadata.designation).toBe("sponsor_a_child");
  });
});
