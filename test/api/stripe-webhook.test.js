// test/api/stripe-webhook.test.js
import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import Stripe from "stripe";
import { insertBasket, insertWorkshopDay, insertPendingRegistration, getWorkshopDayById, reserveSeat } from "../../lib/db.js";
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

    const day = await getWorkshopDayById(env.DB, workshopDayId);
    expect(day.seats_taken).toBe(1); // reserved at checkout time, not incremented again here
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
