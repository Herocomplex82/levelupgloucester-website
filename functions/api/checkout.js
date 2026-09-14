// functions/api/checkout.js
import { getStripeClient } from "../../lib/stripe.js";
import { isValidEmail, requireFields } from "../../lib/validate.js";
import {
  getBasketById,
  getWorkshopDayById,
  reserveSeat,
  releaseSeat,
  insertPendingRegistration,
} from "../../lib/db.js";

// $1/ticket, with a "6 for $5" bundle discount applied to every full group of 6
// (e.g. 7 tickets = one bundle of 6 ($5) + 1 single ($1) = $6; 12 tickets = two
// bundles of 6 = $10). A flat cap on ticketCount (below) prevents this from being
// used to buy unbounded entries for a trivial amount.
const MAX_RAFFLE_TICKETS = 100;

function raffleTicketPriceCents(ticketCount) {
  const bundles = Math.floor(ticketCount / 6);
  const remainder = ticketCount % 6;
  return bundles * 500 + remainder * 100;
}

async function handleRaffle(body, env, origin) {
  const missing = requireFields(body, ["basketId", "ticketCount", "donorName", "donorEmail"]);
  if (missing.length > 0) {
    return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
  }
  if (!isValidEmail(body.donorEmail)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!Number.isInteger(body.ticketCount) || body.ticketCount < 1) {
    return Response.json({ error: "ticketCount must be a positive integer" }, { status: 400 });
  }
  if (body.ticketCount > MAX_RAFFLE_TICKETS) {
    return Response.json(
      { error: `ticketCount cannot exceed ${MAX_RAFFLE_TICKETS}` },
      { status: 400 }
    );
  }

  const basket = await getBasketById(env.DB, body.basketId);
  if (!basket) {
    return Response.json({ error: "Basket not found" }, { status: 404 });
  }

  const stripe = getStripeClient(env);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: body.donorEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Raffle entry — ${basket.name}` },
          unit_amount: raffleTicketPriceCents(body.ticketCount),
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: "raffle",
      basketId: String(body.basketId),
      ticketCount: String(body.ticketCount),
      donorName: body.donorName,
      donorEmail: body.donorEmail,
    },
    success_url: `${origin}/raffle-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/raffle.html`,
  });

  return Response.json({ url: session.url });
}

async function handleRegistration(body, env, origin) {
  const missing = requireFields(body, [
    "workshopDayId",
    "registrationType",
    "childName",
    "childDob",
    "parentName",
    "address",
    "phone",
    "email",
    "emergencyContactName",
    "emergencyContactPhone",
    "waiverSignatureName",
  ]);
  if (missing.length > 0) {
    return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
  }
  if (!isValidEmail(body.email)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  if (body.waiverAccepted !== true) {
    return Response.json({ error: "Waiver must be accepted" }, { status: 400 });
  }
  if (!["full", "half"].includes(body.registrationType)) {
    return Response.json({ error: "Invalid registrationType" }, { status: 400 });
  }

  const day = await getWorkshopDayById(env.DB, body.workshopDayId);
  if (!day) {
    return Response.json({ error: "Workshop day not found" }, { status: 404 });
  }

  const reserved = await reserveSeat(env.DB, body.workshopDayId);
  if (!reserved) {
    return Response.json({ error: "This workshop day is full" }, { status: 409 });
  }

  const priceCents = body.registrationType === "half" ? day.price_half_cents : day.price_full_cents;

  try {
    const { id: registrationId } = await insertPendingRegistration(env.DB, {
      workshopDayId: body.workshopDayId,
      childName: body.childName,
      childDob: body.childDob,
      parentName: body.parentName,
      address: body.address,
      phone: body.phone,
      email: body.email,
      emergencyContactName: body.emergencyContactName,
      emergencyContactPhone: body.emergencyContactPhone,
      allergiesMedical: body.allergiesMedical,
      waiverAccepted: body.waiverAccepted,
      waiverSignatureName: body.waiverSignatureName,
      waiverTimestamp: new Date().toISOString(),
      photoRelease: body.photoRelease === true,
      registrationType: body.registrationType,
      promoCodeUsed: null,
    });

    const stripe = getStripeClient(env);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: body.email,
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `${day.title} — ${body.registrationType === "half" ? "Half day" : "Full day"}` },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "registration",
        registrationId: String(registrationId),
        workshopDayId: String(body.workshopDayId),
      },
      success_url: `${origin}/register-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/register.html`,
    });

    return Response.json({ url: session.url });
  } catch {
    await releaseSeat(env.DB, body.workshopDayId);
    return Response.json({ error: "Something went wrong, please try again" }, { status: 500 });
  }
}

async function handleDonation(body, env, origin) {
  const missing = requireFields(body, ["amountCents", "designation", "donorName", "donorEmail"]);
  if (missing.length > 0) {
    return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
  }
  if (!isValidEmail(body.donorEmail)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!["general", "sponsor_a_child"].includes(body.designation)) {
    return Response.json({ error: "Invalid designation" }, { status: 400 });
  }
  if (!Number.isInteger(body.amountCents) || body.amountCents < 100) {
    return Response.json({ error: "amountCents must be at least 100 ($1)" }, { status: 400 });
  }

  const stripe = getStripeClient(env);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: body.donorEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Donation to Level Up Inc." },
          unit_amount: body.amountCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: "donation",
      designation: body.designation,
      donorName: body.donorName,
      donorEmail: body.donorEmail,
    },
    success_url: `${origin}/donate-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/donate.html`,
  });

  return Response.json({ url: session.url });
}

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    switch (body.type) {
      case "raffle":
        return await handleRaffle(body, env, origin);
      case "registration":
        return await handleRegistration(body, env, origin);
      case "donation":
        return await handleDonation(body, env, origin);
      default:
        return Response.json({ error: "Unknown type" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
