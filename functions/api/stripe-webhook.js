// functions/api/stripe-webhook.js
import Stripe from "stripe";
import { insertRaffleEntry, confirmRegistration, insertDonation } from "../../lib/db.js";

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
      await confirmRegistration(env.DB, Number(metadata.registrationId), session.id);
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
      return Response.json({ received: true, ignored: "unknown metadata.type" });
  }

  return Response.json({ received: true });
}
