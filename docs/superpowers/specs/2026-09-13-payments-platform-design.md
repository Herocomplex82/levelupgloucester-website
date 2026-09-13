# Level Up Gloucester — Payments & Registration Platform (Design)

**Date:** 2026-09-13
**Status:** Approved, pending implementation plan

## Context

Level Up Gloucester currently has no way to collect money online. Registration for
program days runs through a plain Google Form with no payment attached; there is no
donation mechanism at all. Three near-term needs converge on the same underlying gap:

1. A **holiday basket raffle** (10+ board-game baskets, $1/ticket or 6-for-$5, entrant
   picks which basket(s) their tickets go toward), planned for the full holiday season.
2. **Game workshop day registration** — replacing the Google Form with paid,
   capacity-limited signup for future full-day program events (the model the two
   August trial Fridays and future workshop days follow).
3. **General donations**, including a **"sponsor a child"** designation that funds the
   sliding-scale program the org already runs informally.

Rather than adopt a third-party fundraising platform (RallyUp, Zeffy, etc.) for the
raffle and a separate tool later for registration, this spec builds one shared
payments backend, directly on Stripe, hosted under the org's own domain — "do the
work once."

### Why not a hosted platform (RallyUp/Zeffy)?

Evaluated and rejected for this project specifically because Steve wants (a) donor
money to route directly into Level Up's own Stripe account rather than through an
intermediary, and (b) one system that also serves the (not-yet-built) workshop-day
registration and donation flows, rather than a raffle-only tool. The tradeoff,
accepted knowingly: Level Up now owns bug fixes, Stripe API changes, and support
that a vendor would otherwise absorb, and drafts its own legal compliance text
instead of using a vendor-provided template.

### Legal groundwork this design depends on

- **Massachusetts raffle law (M.G.L. c. 271 §7A)** requires a raffle permit from the
  town/city clerk, and eligibility requires the organization to have been active as a
  nonprofit for **at least two years**. Level Up Inc. was incorporated 2026-07-24 —
  nowhere close. Gloucester's own permit process additionally requires a copy of the
  org's 501(c)(3) determination, which Level Up also does not yet have (Form 1023-EZ
  unfiled). **Conclusion: the holiday basket "raffle" must be legally structured as a
  charity sweepstakes, not a raffle** — chance to win with no purchase required, a
  free alternate method of entry, and no permit needed.
- Pokéfest (Nov 15, 2026) has its own in-person $1-ticket raffle in its event plan
  with the identical legal exposure. **Explicitly out of scope for this project** —
  handled separately and manually (in-person, no-purchase-necessary, cash box), per
  Steve's direction 2026-09-13.
- Level Up Inc. is **not yet a determined 501(c)(3)** (EIN 35-2976380 only, Form
  1023-EZ unfiled). No page built under this system may claim donations are
  tax-deductible.

## Goals

- One shared backend (hosting, payments, database) serving three features shipped
  together: holiday basket sweepstakes, workshop-day registration, and donations
  (with sponsor-a-child designation).
- Everything lives under `levelupgloucester.org` — no hand-off to a third-party
  domain for checkout.
- Money settles directly into Level Up Inc.'s own Stripe account.
- Preserve existing organizational practices rather than inventing new ones:
  reuse the existing reviewed liability waiver text, and keep the sliding-scale
  policy as a quiet manual process (no public discount picker).

## Non-goals

- Pokéfest's in-person raffle (handled separately, out of scope).
- Refund automation (manual via Stripe dashboard for v1).
- Recurring/subscription donations (one-time only for v1).
- A public self-serve sliding-scale discount picker.
- Custom-domain checkout branding beyond the existing domain (moot — everything is
  already on-domain by construction of this design).

## Architecture

**Hosting migration:** GitHub Pages → **Cloudflare Pages**. Same domain
(`levelupgloucester.org` / `www.levelupgloucester.org`), same kind of DNS cutover
already performed once for the Google Sites → GitHub Pages migration (repoint the
`www` CNAME, this time at Cloudflare Pages instead of `herocomplex82.github.io`).
Static site content (existing `index.html`, `board-of-directors.html`,
`sample-schedules.html`, `images/`) moves as-is; no redesign.

**Backend:** Cloudflare Pages Functions (serverless, deployed alongside the static
site) plus **Cloudflare D1** (SQLite) as the database. One platform, one dashboard.

**Payments:** Stripe, directly. A Stripe account is created for Level Up Inc. (the
existing EIN is sufficient for Stripe's business verification — 501(c)(3)
determination is not required). The Stripe **secret key lives only in Cloudflare
Pages Functions environment variables**, never shipped to the browser. All Checkout
Sessions are created server-side.

### Request flow (all three features share this shape)

1. Visitor fills out a form on the relevant page (basket + ticket count; or workshop
   registration + waiver; or donation amount + designation).
2. Page calls `POST /api/checkout` with the relevant payload. The Function validates
   the request (e.g., checks workshop-day capacity isn't exceeded), creates a Stripe
   Checkout Session with correct line items and metadata, and returns the session URL.
3. Browser redirects to Stripe's hosted Checkout page (card entry happens entirely on
   Stripe's infrastructure — no PCI scope for Level Up).
4. On completion, Stripe calls `POST /api/stripe-webhook`. The Function verifies the
   webhook signature, then writes a confirmed row into the appropriate D1 table.
5. Visitor is redirected back to a confirmation page on the site.

Nothing is considered "confirmed" until the webhook fires — the checkout redirect
alone is not trusted, since a visitor could close the tab or the payment could fail
after redirect.

### Data model (Cloudflare D1)

```
baskets            id, name, description, image_url, active
raffle_entries     id, basket_id, donor_name, donor_email, ticket_count,
                   entry_method ('paid' | 'free_mail_in'), stripe_session_id,
                   created_at

workshop_days      id, title, date, location, price_full, price_half,
                   capacity, seats_taken

registrations      id, workshop_day_id, child_name, child_dob, parent_name,
                   address, phone, email, emergency_contact_name,
                   emergency_contact_phone, allergies_medical, waiver_accepted,
                   waiver_signature_name, waiver_timestamp, photo_release,
                   promo_code_used, stripe_session_id, created_at

donations          id, donor_name, donor_email, amount, designation
                   ('general' | 'sponsor_a_child'), stripe_session_id, created_at
```

An `admin_token` (single shared credential, stored as a Cloudflare secret, not in
D1) gates the admin endpoints for v1 — no need for a full user/auth system at this
scale.

## Features

### 1. Holiday Basket Sweepstakes (`raffle.html`)

- Grid of baskets (photo, description, matches existing `.program-card` visual
  language from the homepage).
- Entry: choose a basket, choose ticket count ($1 each or 6-for-$5 — Checkout applies
  the bundle pricing), checkout via Stripe.
- **Free alternate method of entry**, required to keep this a legal sweepstakes
  rather than a permit-requiring raffle: a visible "Enter Free by Mail" section with
  instructions to mail a 3x5 card with name/contact info/chosen basket to Level Up's
  address. Mailed entries are logged into `raffle_entries` with
  `entry_method = 'free_mail_in'` and receive the average number of entries a paid
  donor earned for that basket (rounded up), per standard sweepstakes practice.
- **Official Rules** page/section, drafted for Level Up specifically (not copied
  verbatim from any vendor), structured after the publicly-published RallyUp
  sweepstakes rules template
  ([rallyup.com/sweepstakes-official-rules](https://rallyup.com/sweepstakes-official-rules/)):
  no-purchase-necessary clause, eligibility, free alternate entry instructions and
  limit (one per household), entry mechanics, random drawing date and process,
  winner notification/verification window, odds-of-winning disclosure, prize
  description with approximate value and substitution rights, sponsor identification
  (Level Up Inc.), and Massachusetts as the governing jurisdiction (not RallyUp's
  Arizona clause). **Steve must review this text before publishing** — there is no
  vendor compliance guarantee behind it now.
- No tax-deductibility language anywhere on the page.

### 2. Game Workshop Day Registration (`register.html`)

- Lists upcoming workshop day(s) pulled from `workshop_days`, with a live
  seats-remaining indicator (`capacity - seats_taken`, checked server-side at
  checkout time to prevent overselling).
- Registration form fields are taken directly from the existing
  `Legal & Governance/Liability_Waiver.md`: child name/DOB, parent/guardian name,
  address, phone, email, emergency contact, allergies/medical notes, assumption-of-
  risk and hold-harmless consent (checkbox), photo/video release (opt-in/opt-out
  radio, matching the existing form's wording), and a typed-name e-signature with a
  server-recorded timestamp.
- On submit, the Function records the registration as pending and creates a Stripe
  Checkout Session for the applicable price (`price_full` or `price_half`). Webhook
  confirmation marks the registration confirmed and increments `seats_taken`.
- **Sliding scale:** no public discount UI. A family emails
  `levelupgloucester@gmail.com` as today (per the existing `Parent_FAQ.md` practice);
  Steve or a board member manually issues a one-off Stripe promotion code, which the
  family enters at Checkout. Preserves the current quiet, dignity-preserving process
  exactly as-is.

### 3. Donations (`donate.html`)

- Single form: amount (presets of $40 / $65 / custom, tied to real half-day/full-day
  program costs) and one checkbox — *"Earmark my donation to sponsor another child's
  registration."* Unchecked donations are `designation = 'general'`; checked ones are
  `designation = 'sponsor_a_child'`.
- One-time payment only (no recurring/subscription billing in v1).
- Explicit note that Level Up Inc. is a Massachusetts nonprofit corporation and that
  501(c)(3) status is pending — donations are **not** represented as tax-deductible.

### 4. Admin view (`admin.html`)

- Single shared password (Cloudflare secret), not tied to individual user accounts.
- Lists raffle entries (filterable by basket), registrations (filterable by workshop
  day, with waiver/photo-release status visible), and donations.
- CSV export for each table, so Steve/the board can pull data into a spreadsheet for
  the actual raffle drawing or for grant/board reporting.

## Security considerations

- Stripe secret key and webhook signing secret live only in Cloudflare Pages
  environment variables (encrypted, not in source control).
- All state-changing writes to D1 happen only from the webhook handler after Stripe
  signature verification — never trust client-submitted "payment succeeded" claims.
- Admin endpoints require the shared admin token on every request; token is never
  embedded in any client-side JS bundle, only entered at runtime and held in a
  short-lived session cookie.
- Waiver e-signature timestamp is server-generated (not client-supplied) to keep it
  meaningful as a record.

## Testing / verification plan

- All three checkout flows built and exercised end-to-end against **Stripe test
  mode** (test card numbers) before any live-mode key is used.
- Cloudflare Pages preview deployments (per-branch) used to verify webhook delivery
  and D1 writes in a non-production environment before merging to the production
  branch.
- Capacity-limit logic specifically tested for the race condition of two people
  checking out for the last seat simultaneously.
- Visual/responsive check of all three new pages against the existing site's design
  system (matches the pattern used for the 2026-09-13 homepage content refresh).

## Deployment sequencing

1. Set up Cloudflare Pages project, connect to the existing GitHub repo.
2. Set up Stripe account for Level Up Inc.; configure test-mode keys as Cloudflare
   secrets.
3. Build D1 schema and Functions (`/api/checkout`, `/api/stripe-webhook`,
   `/api/admin/*`).
4. Build the three new pages plus `admin.html`.
5. Draft Official Rules and adapt the waiver text; **Steve reviews both before
   anything goes live**, consistent with his standing review-before-external-
   commitment practice.
6. End-to-end test in Stripe test mode.
7. Switch to Stripe live-mode keys; DNS cutover from GitHub Pages to Cloudflare
   Pages.
8. Announce/launch.

## Open items for Steve

- Review and approve the Official Rules text and the adapted online waiver text
  before launch (no vendor compliance backstop now — this is on us to get right).
- Decide Pokéfest's in-person sweepstakes handling separately (flagged, not solved
  here).
- Provide/confirm the actual holiday raffle drawing date and the specific basket
  list/photos when ready — not needed for this design, needed before content goes
  live.
