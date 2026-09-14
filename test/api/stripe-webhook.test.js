// test/api/stripe-webhook.test.js
import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import Stripe from "stripe";
import * as stripeLib from "../../lib/stripe.js";
import {
  insertBasket,
  insertWorkshopDay,
  insertPendingRegistration,
  getWorkshopDayById,
  getRegistrationById,
  reserveSeat,
} from "../../lib/db.js";
import { onRequestPost } from "../../functions/api/stripe-webhook.js";

const WEBHOOK_SECRET = "whsec_test_secret";

async function signedWebhookRequest(eventPayload) {
  const stripe = new Stripe("sk_test_dummy", { httpClient: Stripe.createFetchHttpClient() });
  const webCrypto = Stripe.createSubtleCryptoProvider();
  const payloadString = JSON.stringify(eventPayload);
  const header = await stripe.webhooks.generateTestHeaderStringAsync({
    payload: payloadString,
    secret: WEBHOOK_SECRET,
    cryptoProvider: webCrypto,
  });

  return new Request("https://levelupgloucester.org/api/stripe-webhook", {
    method: "POST",
    headers: { "Stripe-Signature": header },
    body: payloadString,
  });
}

function checkoutCompletedEvent(sessionOverrides) {
  return {
    id: "evt_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        customer_details: { email: "buyer@example.com", name: "Buyer Name" },
        amount_total: 500,
        metadata: {},
        ...sessionOverrides,
      },
    },
  };
}

function checkoutExpiredEvent(sessionOverrides) {
  return {
    id: "evt_test_expired_1",
    type: "checkout.session.expired",
    data: {
      object: {
        id: "cs_test_expired_1",
        metadata: {},
        ...sessionOverrides,
      },
    },
  };
}

describe("POST /api/stripe-webhook", () => {
  it("rejects a request with a bad signature", async () => {
    const request = new Request("https://levelupgloucester.org/api/stripe-webhook", {
      method: "POST",
      headers: { "Stripe-Signature": "t=1,v1=deadbeef" },
      body: JSON.stringify(checkoutCompletedEvent({})),
    });

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(400);
  });

  it("records a raffle entry on checkout.session.completed", async () => {
    const { id: basketId } = await insertBasket(env.DB, {
      name: "Wingspan Bundle",
      description: "Wingspan + European Expansion",
      image_path: "images/baskets/wingspan.jpg",
    });

    const request = await signedWebhookRequest(
      checkoutCompletedEvent({
        metadata: {
          type: "raffle",
          basketId: String(basketId),
          ticketCount: "6",
          donorName: "Jamie Walker",
          donorEmail: "jamie@example.com",
        },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);

    const { results } = await env.DB.prepare(
      "SELECT * FROM raffle_entries WHERE basket_id = ?"
    )
      .bind(basketId)
      .all();
    expect(results).toHaveLength(1);
    expect(results[0].ticket_count).toBe(6);
    expect(results[0].entry_method).toBe("paid");
  });

  it("confirms a pending registration and leaves seats_taken untouched (already reserved at checkout)", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "April Vacation Workshop",
      eventDate: "2027-04-21",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 10,
    });
    // Simulate /api/checkout's behavior: it reserves the seat at checkout
    // time (before creating the Stripe session), so by the time this webhook
    // fires the seat is already counted. The brief's original test omitted
    // this call, which made the "seats_taken untouched" assertion below
    // fail against a correct implementation (seats_taken stayed 0, not 1).
    await reserveSeat(env.DB, workshopDayId);
    const { id: registrationId } = await insertPendingRegistration(env.DB, {
      workshopDayId,
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
    });

    const request = await signedWebhookRequest(
      checkoutCompletedEvent({
        id: "cs_test_reg_1",
        metadata: { type: "registration", registrationId: String(registrationId), workshopDayId: String(workshopDayId) },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);

    const registration = await env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(registrationId).first();
    expect(registration.status).toBe("confirmed");
    expect(registration.stripe_session_id).toBe("cs_test_reg_1");
    // Finding 1: the amount actually charged is recorded, and no promo code was applied.
    expect(registration.amount_paid_cents).toBe(500);
    expect(registration.promo_code_used).toBeNull();

    const day = await getWorkshopDayById(env.DB, workshopDayId);
    expect(day.seats_taken).toBe(1); // reserved at checkout time, not incremented again here
  });

  it("confirms a registration with an applied promo code, storing both the code and the discounted amount (Finding 1)", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "May Vacation Workshop",
      eventDate: "2027-05-21",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 10,
    });
    await reserveSeat(env.DB, workshopDayId);
    const { id: registrationId } = await insertPendingRegistration(env.DB, {
      workshopDayId,
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
    });

    // Simulate the promotion code being applied: the webhook payload shows a
    // non-zero discount, which triggers a follow-up `sessions.retrieve` call
    // (expanded) to look up the actual promo code text.
    const retrieveMock = vi.fn().mockResolvedValue({
      id: "cs_test_promo_reg_1",
      discounts: [{ promotion_code: { code: "SLIDING20" } }],
    });
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue({
      checkout: { sessions: { retrieve: retrieveMock } },
    });

    const request = await signedWebhookRequest(
      checkoutCompletedEvent({
        id: "cs_test_promo_reg_1",
        amount_total: 3900,
        total_details: { amount_discount: 2600, amount_tax: 0, amount_shipping: 0 },
        metadata: { type: "registration", registrationId: String(registrationId), workshopDayId: String(workshopDayId) },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);
    expect(retrieveMock).toHaveBeenCalledWith(
      "cs_test_promo_reg_1",
      expect.objectContaining({ expand: expect.arrayContaining(["discounts.promotion_code"]) })
    );

    const registration = await env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(registrationId).first();
    expect(registration.status).toBe("confirmed");
    expect(registration.amount_paid_cents).toBe(3900);
    expect(registration.promo_code_used).toBe("SLIDING20");
  });

  it("redacts a secret-shaped substring before logging when the promotion code lookup fails (unsanitized-error-message-logging fix)", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "June Vacation Workshop",
      eventDate: "2027-06-21",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 10,
    });
    await reserveSeat(env.DB, workshopDayId);
    const { id: registrationId } = await insertPendingRegistration(env.DB, {
      workshopDayId,
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
    });

    // Synthesize a follow-up API failure whose message happens to embed a
    // Stripe-secret-shaped substring, as a misconfiguration error might.
    const retrieveMock = vi
      .fn()
      .mockRejectedValue(new Error("invalid api key sk_live_fakeSecretForTest123 provided"));
    vi.spyOn(stripeLib, "getStripeClient").mockReturnValue({
      checkout: { sessions: { retrieve: retrieveMock } },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const request = await signedWebhookRequest(
      checkoutCompletedEvent({
        id: "cs_test_promo_lookup_fail_1",
        amount_total: 3900,
        total_details: { amount_discount: 2600, amount_tax: 0, amount_shipping: 0 },
        metadata: { type: "registration", registrationId: String(registrationId), workshopDayId: String(workshopDayId) },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    const loggedMessage = errorSpy.mock.calls[0].join(" ");
    expect(loggedMessage).not.toMatch(/sk_live_fakeSecretForTest123/);
    expect(loggedMessage).toContain("[REDACTED]");

    // The registration still confirms (promo code lookup failure degrades gracefully).
    const registration = await env.DB.prepare("SELECT * FROM registrations WHERE id = ?").bind(registrationId).first();
    expect(registration.status).toBe("confirmed");
    expect(registration.promo_code_used).toBeNull();

    errorSpy.mockRestore();
  });

  it("records a donation", async () => {
    const request = await signedWebhookRequest(
      checkoutCompletedEvent({
        id: "cs_test_donation_1",
        amount_total: 4000,
        metadata: { type: "donation", designation: "sponsor_a_child", donorName: "Anonymous", donorEmail: "donor@example.com" },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);

    const { results } = await env.DB.prepare("SELECT * FROM donations WHERE stripe_session_id = ?")
      .bind("cs_test_donation_1")
      .all();
    expect(results).toHaveLength(1);
    expect(results[0].amount_cents).toBe(4000);
    expect(results[0].designation).toBe("sponsor_a_child");
  });

  it("is idempotent when the same raffle checkout.session.completed event is redelivered", async () => {
    const { id: basketId } = await insertBasket(env.DB, {
      name: "Redelivery Bundle",
      description: "Used to test webhook idempotency",
      image_path: "images/baskets/redelivery.jpg",
    });

    const payload = checkoutCompletedEvent({
      id: "cs_test_redelivered_raffle",
      metadata: {
        type: "raffle",
        basketId: String(basketId),
        ticketCount: "3",
        donorName: "Jordan Lee",
        donorEmail: "jordan@example.com",
      },
    });

    const firstRequest = await signedWebhookRequest(payload);
    const firstResponse = await onRequestPost({
      request: firstRequest,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    const secondRequest = await signedWebhookRequest(payload);
    const secondResponse = await onRequestPost({
      request: secondRequest,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const { results } = await env.DB.prepare(
      "SELECT * FROM raffle_entries WHERE stripe_session_id = ?"
    )
      .bind("cs_test_redelivered_raffle")
      .all();
    expect(results).toHaveLength(1);
  });

  it("logs an error when metadata.type is unrecognized on a real completed payment", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const request = await signedWebhookRequest(
      checkoutCompletedEvent({
        id: "cs_test_unknown_type",
        metadata: { type: "mystery-flow" },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = errorSpy.mock.calls[0].join(" ");
    expect(loggedMessage).toContain("cs_test_unknown_type");
    expect(loggedMessage).toContain("mystery-flow");

    errorSpy.mockRestore();
  });
});

describe("POST /api/stripe-webhook — checkout.session.expired (Finding 4)", () => {
  it("releases the reserved seat and marks a pending registration as expired", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "November Workshop",
      eventDate: "2027-11-01",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 1,
    });
    await reserveSeat(env.DB, workshopDayId); // simulates /api/checkout reserving the seat at checkout time
    const { id: registrationId } = await insertPendingRegistration(env.DB, {
      workshopDayId,
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
    });

    const dayBefore = await getWorkshopDayById(env.DB, workshopDayId);
    expect(dayBefore.seats_taken).toBe(1);

    const request = await signedWebhookRequest(
      checkoutExpiredEvent({
        id: "cs_test_expired_reg_1",
        metadata: { type: "registration", registrationId: String(registrationId), workshopDayId: String(workshopDayId) },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);

    const registration = await getRegistrationById(env.DB, registrationId);
    expect(registration.status).toBe("expired");

    const dayAfter = await getWorkshopDayById(env.DB, workshopDayId);
    expect(dayAfter.seats_taken).toBe(0);
  });

  it("does not release a seat or change status for a registration that already confirmed (idempotent against a race with checkout.session.completed)", async () => {
    const { id: workshopDayId } = await insertWorkshopDay(env.DB, {
      title: "December Workshop",
      eventDate: "2027-12-01",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 1,
    });
    await reserveSeat(env.DB, workshopDayId);
    const { id: registrationId } = await insertPendingRegistration(env.DB, {
      workshopDayId,
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
    });

    const completedRequest = await signedWebhookRequest(
      checkoutCompletedEvent({
        id: "cs_test_race_1",
        metadata: { type: "registration", registrationId: String(registrationId), workshopDayId: String(workshopDayId) },
      })
    );
    await onRequestPost({ request: completedRequest, env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } });

    const expiredRequest = await signedWebhookRequest(
      checkoutExpiredEvent({
        id: "cs_test_race_1",
        metadata: { type: "registration", registrationId: String(registrationId), workshopDayId: String(workshopDayId) },
      })
    );
    const response = await onRequestPost({ request: expiredRequest, env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } });

    expect(response.status).toBe(200);

    const registration = await getRegistrationById(env.DB, registrationId);
    expect(registration.status).toBe("confirmed"); // must not be flipped back to expired

    const day = await getWorkshopDayById(env.DB, workshopDayId);
    expect(day.seats_taken).toBe(1); // seat must not be released a second time
  });

  it("ignores an expired event for a non-registration checkout type", async () => {
    const request = await signedWebhookRequest(
      checkoutExpiredEvent({
        id: "cs_test_expired_raffle_1",
        metadata: { type: "raffle" },
      })
    );

    const response = await onRequestPost({
      request,
      env: { ...env, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });

    expect(response.status).toBe(200);
  });
});
