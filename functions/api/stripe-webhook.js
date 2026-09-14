// functions/api/stripe-webhook.js
import Stripe from "stripe";
import { getStripeClient } from "../../lib/stripe.js";
import { redactSecrets } from "../../lib/validate.js";
import {
  insertRaffleEntry,
  confirmRegistration,
  insertDonation,
  getRegistrationById,
  releaseSeat,
  expireRegistration,
} from "../../lib/db.js";

// A promotion code, when applied, shows up as an expandable reference on the
// Checkout Session's `discounts` array. The webhook payload itself never
// carries the expanded PromotionCode object (Stripe does not support
// `expand` on push events), so getting the human-readable code requires a
// follow-up API call with `expand: ["discounts.promotion_code"]`. We only
// make that call when a discount was actually applied (total_details shows a
// non-zero amount_discount), so the common no-discount path never needs it.
async function readAppliedPromotionCode(env, session) {
  const discountAmount = session.total_details?.amount_discount ?? 0;
  if (discountAmount <= 0) {
    return null;
  }

  try {
    const stripe = getStripeClient(env);
    const expanded = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["discounts.promotion_code"],
    });
    const discount = expanded.discounts?.[0];
    const promotionCode = discount?.promotion_code;
    if (!promotionCode) return null;
    return typeof promotionCode === "string" ? promotionCode : promotionCode.code ?? null;
  } catch (err) {
    console.error(
      `stripe-webhook: failed to look up promotion code for session ${session.id}: ${redactSecrets(err.message)}`
    );
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  const signature = request.headers.get("Stripe-Signature");
  const rawBody = await request.text();

  const stripe = new Stripe(env.STRIPE_SECRET_KEY ?? "sk_test_placeholder", {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const webCrypto = Stripe.createSubtleCryptoProvider();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      webCrypto
    );
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const metadata = session.metadata ?? {};
    if (metadata.type === "registration" && metadata.registrationId) {
      const registrationId = Number(metadata.registrationId);
      const registration = await getRegistrationById(env.DB, registrationId);
      // Only act if the registration is still pending — protects against a
      // redelivered/duplicate expired event releasing a seat twice, or
      // racing a completed event that already confirmed it.
      if (registration && registration.status === "pending") {
        await releaseSeat(env.DB, registration.workshop_day_id);
        await expireRegistration(env.DB, registrationId);
      }
    }
    return Response.json({ received: true });
  }

  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const metadata = session.metadata ?? {};

  switch (metadata.type) {
    case "raffle": {
      await insertRaffleEntry(env.DB, {
        basketId: Number(metadata.basketId),
        donorName: metadata.donorName,
        donorEmail: metadata.donorEmail,
        ticketCount: Number(metadata.ticketCount),
        entryMethod: "paid",
        stripeSessionId: session.id,
      });
      break;
    }
    case "registration": {
      const promoCodeUsed = await readAppliedPromotionCode(env, session);
      await confirmRegistration(env.DB, Number(metadata.registrationId), {
        stripeSessionId: session.id,
        amountPaidCents: session.amount_total,
        promoCodeUsed,
      });
      break;
    }
    case "donation": {
      await insertDonation(env.DB, {
        donorName: metadata.donorName,
        donorEmail: metadata.donorEmail,
        amountCents: session.amount_total,
        designation: metadata.designation,
        stripeSessionId: session.id,
      });
      break;
    }
    default:
      console.error(
        redactSecrets(
          `stripe-webhook: unrecognized metadata.type "${metadata.type}" for session ${session.id}`
        )
      );
      return Response.json({ received: true, ignored: "unknown metadata.type" });
  }

  return Response.json({ received: true });
}
