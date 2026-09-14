# Level Up Payments & Registration Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared Stripe-direct payments backend on Cloudflare Pages that
powers three features on levelupgloucester.org: the holiday basket sweepstakes,
game-workshop-day registration (replacing the Google Form), and donations with a
sponsor-a-child designation.

**Architecture:** Cloudflare Pages serves the existing static site plus four new
pages. Cloudflare Pages Functions (serverless, ES modules under `functions/`) handle
`/api/*` routes. Cloudflare D1 (SQLite) stores baskets, raffle entries, workshop
days, registrations, and donations. Stripe Checkout Sessions are created
server-side and confirmed via a webhook — nothing is written to D1 until Stripe
confirms payment.

**Tech Stack:** Cloudflare Pages + Pages Functions, Cloudflare D1, Wrangler CLI,
Stripe (`stripe` npm package on the Workers runtime via `Stripe.createFetchHttpClient()`),
Vitest + `@cloudflare/vitest-pool-workers` for testing.

## Global Constraints

- Everything ships under `levelupgloucester.org` — no third-party checkout domain.
- Stripe secret key and webhook signing secret live **only** as Cloudflare Pages
  environment secrets, never in source control, never sent to the browser.
- No page may claim donations or raffle purchases are tax-deductible — Level Up
  Inc.'s 501(c)(3) determination is still pending (EIN 35-2976380 only).
- The holiday raffle must work as a legal charity sweepstakes: no purchase
  necessary to enter or win, with a working free alternate method of entry.
- Registration form fields and waiver/consent language must match
  `Legal & Governance/Liability_Waiver.md` exactly — do not invent new legal wording.
- Sliding-scale discounts are never a public, self-serve UI element — only a
  Stripe promotion code entered at Checkout, issued manually by a human after an
  email exchange.
- D1 is the source of truth for "did this payment happen" — a Stripe Checkout
  redirect alone is never trusted; only a verified webhook event writes data.
- Existing pages (`index.html`, `board-of-directors.html`, `sample-schedules.html`)
  are not redesigned or restyled as part of this work.

---

## File Structure

```
Level Up Gloucester/Website/
├── index.html, board-of-directors.html, sample-schedules.html, images/   (existing, untouched)
├── assets/
│   └── site.css                     (NEW — shared design tokens/components, extracted
│                                       from index.html's inline <style>, used only by
│                                       the four new pages below)
├── raffle.html                      (NEW)
├── raffle-success.html              (NEW)
├── register.html                    (NEW)
├── register-success.html            (NEW)
├── donate.html                      (NEW)
├── donate-success.html              (NEW)
├── admin.html                       (NEW)
├── lib/                             (NEW — shared server code; lives OUTSIDE
│   │                                  functions/ so Pages doesn't treat it as routes)
│   ├── db.js                        — D1 query helpers, one per table/operation
│   ├── stripe.js                    — Stripe client factory for the Workers runtime
│   ├── validate.js                  — input validation helpers
│   └── auth.js                      — admin-cookie verification helper
├── functions/
│   └── api/
│       ├── baskets.js               — GET /api/baskets (public, active baskets)
│       ├── workshop-days.js         — GET /api/workshop-days (public, upcoming + seats left)
│       ├── checkout.js              — POST /api/checkout (raffle | registration | donation)
│       ├── stripe-webhook.js        — POST /api/stripe-webhook
│       └── admin/
│           ├── login.js             — POST /api/admin/login
│           ├── entries.js           — GET /api/admin/entries?type=... (+CSV)
│           └── manage.js            — POST /api/admin/manage (create basket/workshop day)
├── migrations/
│   └── 0001_init.sql                — D1 schema
├── test/
│   ├── apply-migrations.js          — vitest setup file
│   ├── lib/db.test.js
│   └── api/
│       ├── baskets.test.js
│       ├── workshop-days.test.js
│       ├── checkout.test.js
│       ├── stripe-webhook.test.js
│       └── admin.test.js
├── wrangler.toml
├── package.json
└── vitest.config.js
```

**Why `lib/` lives outside `functions/`:** Cloudflare Pages Functions maps every
file under `functions/` to a route by its path. A shared helper module placed
inside `functions/` (e.g. `functions/lib/db.js`) would be mapped to `/lib/db` as
a dead route. Cloudflare's own docs pattern shared code from a sibling directory
imported by relative path — that's what `lib/` at the project root does here.

---

### Task 1: Project scaffolding, D1 database, and Wrangler config

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Modify: `.gitignore` (create if it doesn't exist)

**Interfaces:**
- Produces: the `DB` D1 binding (used by every later Function/lib module as
  `env.DB`), and secret names `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `ADMIN_TOKEN` (referenced but not set until Task 16).

- [ ] **Step 1: Create the D1 database**

Run:
```bash
cd "Level Up Gloucester/Website"
npx wrangler d1 create levelup-payments
```
Expected: output includes a `database_id` (a UUID). Copy it — it goes in
`wrangler.toml` below.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "levelup-website",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler pages dev . --d1 DB=levelup-payments",
    "test": "vitest run",
    "migrate:local": "wrangler d1 migrations apply levelup-payments --local",
    "migrate:remote": "wrangler d1 migrations apply levelup-payments --remote",
    "deploy": "wrangler pages deploy ."
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.7.0",
    "vitest": "^3.2.0",
    "wrangler": "^4.0.0"
  },
  "dependencies": {
    "stripe": "^19.0.0"
  }
}
```

- [ ] **Step 3: Write `wrangler.toml`**

Replace `<DATABASE_ID>` with the UUID from Step 1.

```toml
"$schema" = "./node_modules/wrangler/config-schema.json"
name = "levelup-website"
pages_build_output_dir = "."
compatibility_date = "2026-09-13"
compatibility_flags = [ "nodejs_compat" ]

[[d1_databases]]
binding = "DB"
database_name = "levelup-payments"
database_id = "<DATABASE_ID>"
```

- [ ] **Step 4: Update `.gitignore`**

Add (create the file with just this content if it doesn't exist yet):
```
node_modules/
.wrangler/
.dev.vars
```

- [ ] **Step 5: Install dependencies**

Run:
```bash
npm install
```
Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json wrangler.toml .gitignore
git commit -m "chore: scaffold Cloudflare Pages project with D1 binding"
```

---

### Task 2: D1 schema migration and test harness

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `vitest.config.js`
- Create: `test/apply-migrations.js`
- Test: `test/smoke.test.js`

**Interfaces:**
- Produces: tables `baskets`, `raffle_entries`, `workshop_days`, `registrations`,
  `donations` (exact columns below — every later task's SQL depends on these
  exact names/types). Produces the `env` global (from `cloudflare:test`) that
  every later test file uses to get a real D1 binding.

- [ ] **Step 1: Write the schema migration**

```sql
-- migrations/0001_init.sql

CREATE TABLE baskets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_path TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE raffle_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  basket_id INTEGER NOT NULL REFERENCES baskets(id),
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  ticket_count INTEGER NOT NULL,
  entry_method TEXT NOT NULL CHECK (entry_method IN ('paid', 'free_mail_in')),
  stripe_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workshop_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  location TEXT NOT NULL,
  price_full_cents INTEGER NOT NULL,
  price_half_cents INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  seats_taken INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop_day_id INTEGER NOT NULL REFERENCES workshop_days(id),
  child_name TEXT NOT NULL,
  child_dob TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  emergency_contact_name TEXT NOT NULL,
  emergency_contact_phone TEXT NOT NULL,
  allergies_medical TEXT,
  waiver_accepted INTEGER NOT NULL,
  waiver_signature_name TEXT NOT NULL,
  waiver_timestamp TEXT NOT NULL,
  photo_release INTEGER NOT NULL,
  registration_type TEXT NOT NULL CHECK (registration_type IN ('full','half')),
  promo_code_used TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed')),
  stripe_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  designation TEXT NOT NULL CHECK (designation IN ('general','sponsor_a_child')),
  stripe_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Write the Vitest config**

```js
// vitest.config.js
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig, defineProject, mergeConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return mergeConfig(
    {},
    defineProject({
      plugins: [
        cloudflareTest({
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        }),
      ],
      test: {
        setupFiles: ["./test/apply-migrations.js"],
      },
    })
  );
});
```

- [ ] **Step 3: Write the migration setup file**

```js
// test/apply-migrations.js
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 4: Write a smoke test**

```js
// test/smoke.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

describe("D1 schema", () => {
  it("creates all five tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all();
    const names = results.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "baskets",
        "donations",
        "raffle_entries",
        "registrations",
        "workshop_days",
      ])
    );
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/smoke.test.js`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add migrations/ vitest.config.js test/apply-migrations.js test/smoke.test.js
git commit -m "feat: add D1 schema and vitest-pool-workers test harness"
```

---

### Task 3: `lib/db.js` — shared D1 query helpers

**Files:**
- Create: `lib/db.js`
- Test: `test/lib/db.test.js`

**Interfaces:**
- Consumes: `env.DB` (D1Database, from Task 1/2).
- Produces (every function takes `db` as its first argument, the `env.DB`
  binding):
  - `getActiveBaskets(db) -> Promise<Array<{id, name, description, image_path}>>`
  - `getBasketById(db, id) -> Promise<object|null>`
  - `insertBasket(db, {name, description, image_path}) -> Promise<{id}>`
  - `insertRaffleEntry(db, {basketId, donorName, donorEmail, ticketCount, entryMethod, stripeSessionId}) -> Promise<{id}>`
  - `getUpcomingWorkshopDays(db) -> Promise<Array<{id, title, event_date, location, price_full_cents, price_half_cents, seatsRemaining}>>`
  - `getWorkshopDayById(db, id) -> Promise<object|null>`
  - `insertWorkshopDay(db, {title, eventDate, location, priceFullCents, priceHalfCents, capacity}) -> Promise<{id}>`
  - `reserveSeat(db, workshopDayId) -> Promise<boolean>` — atomically increments
    `seats_taken` only if `seats_taken < capacity`; returns `true` if a seat was
    reserved, `false` if full.
  - `insertPendingRegistration(db, {...all registration columns except status/stripe_session_id}) -> Promise<{id}>`
  - `confirmRegistration(db, id, stripeSessionId) -> Promise<void>` — sets
    `status = 'confirmed'`, `stripe_session_id`.
  - `insertDonation(db, {donorName, donorEmail, amountCents, designation, stripeSessionId}) -> Promise<{id}>`
  - `listRaffleEntries(db, {basketId} = {}) -> Promise<Array>`
  - `listRegistrations(db, {workshopDayId} = {}) -> Promise<Array>`
  - `listDonations(db) -> Promise<Array>`

- [ ] **Step 1: Write the failing tests for baskets + the reserveSeat race condition**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lib/db.test.js`
Expected: FAIL — `lib/db.js` does not exist yet.

- [ ] **Step 3: Implement `lib/db.js`**

```js
// lib/db.js

export async function getActiveBaskets(db) {
  const { results } = await db
    .prepare("SELECT id, name, description, image_path FROM baskets WHERE active = 1 ORDER BY id")
    .all();
  return results;
}

export async function getBasketById(db, id) {
  return db.prepare("SELECT * FROM baskets WHERE id = ?").bind(id).first();
}

export async function insertBasket(db, { name, description, image_path }) {
  const { meta } = await db
    .prepare("INSERT INTO baskets (name, description, image_path) VALUES (?, ?, ?)")
    .bind(name, description, image_path)
    .run();
  return { id: meta.last_row_id };
}

export async function insertRaffleEntry(
  db,
  { basketId, donorName, donorEmail, ticketCount, entryMethod, stripeSessionId = null }
) {
  const { meta } = await db
    .prepare(
      `INSERT INTO raffle_entries
        (basket_id, donor_name, donor_email, ticket_count, entry_method, stripe_session_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(basketId, donorName, donorEmail, ticketCount, entryMethod, stripeSessionId)
    .run();
  return { id: meta.last_row_id };
}

export async function getUpcomingWorkshopDays(db) {
  const { results } = await db
    .prepare(
      `SELECT id, title, event_date, location, price_full_cents, price_half_cents,
              capacity, seats_taken, (capacity - seats_taken) AS seatsRemaining
       FROM workshop_days
       WHERE active = 1 AND event_date >= date('now')
       ORDER BY event_date`
    )
    .all();
  return results;
}

export async function getWorkshopDayById(db, id) {
  return db.prepare("SELECT * FROM workshop_days WHERE id = ?").bind(id).first();
}

export async function insertWorkshopDay(
  db,
  { title, eventDate, location, priceFullCents, priceHalfCents, capacity }
) {
  const { meta } = await db
    .prepare(
      `INSERT INTO workshop_days
        (title, event_date, location, price_full_cents, price_half_cents, capacity)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(title, eventDate, location, priceFullCents, priceHalfCents, capacity)
    .run();
  return { id: meta.last_row_id };
}

export async function reserveSeat(db, workshopDayId) {
  const { meta } = await db
    .prepare(
      `UPDATE workshop_days
       SET seats_taken = seats_taken + 1
       WHERE id = ? AND seats_taken < capacity`
    )
    .bind(workshopDayId)
    .run();
  return meta.changes > 0;
}

export async function insertPendingRegistration(db, r) {
  const { meta } = await db
    .prepare(
      `INSERT INTO registrations
        (workshop_day_id, child_name, child_dob, parent_name, address, phone, email,
         emergency_contact_name, emergency_contact_phone, allergies_medical,
         waiver_accepted, waiver_signature_name, waiver_timestamp, photo_release,
         registration_type, promo_code_used, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .bind(
      r.workshopDayId,
      r.childName,
      r.childDob,
      r.parentName,
      r.address,
      r.phone,
      r.email,
      r.emergencyContactName,
      r.emergencyContactPhone,
      r.allergiesMedical ?? null,
      r.waiverAccepted ? 1 : 0,
      r.waiverSignatureName,
      r.waiverTimestamp,
      r.photoRelease ? 1 : 0,
      r.registrationType,
      r.promoCodeUsed ?? null
    )
    .run();
  return { id: meta.last_row_id };
}

export async function confirmRegistration(db, id, stripeSessionId) {
  await db
    .prepare("UPDATE registrations SET status = 'confirmed', stripe_session_id = ? WHERE id = ?")
    .bind(stripeSessionId, id)
    .run();
}

export async function insertDonation(db, { donorName, donorEmail, amountCents, designation, stripeSessionId }) {
  const { meta } = await db
    .prepare(
      `INSERT INTO donations (donor_name, donor_email, amount_cents, designation, stripe_session_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(donorName, donorEmail, amountCents, designation, stripeSessionId)
    .run();
  return { id: meta.last_row_id };
}

export async function listRaffleEntries(db, { basketId } = {}) {
  const stmt = basketId
    ? db.prepare("SELECT * FROM raffle_entries WHERE basket_id = ? ORDER BY created_at DESC").bind(basketId)
    : db.prepare("SELECT * FROM raffle_entries ORDER BY created_at DESC");
  const { results } = await stmt.all();
  return results;
}

export async function listRegistrations(db, { workshopDayId } = {}) {
  const stmt = workshopDayId
    ? db
        .prepare("SELECT * FROM registrations WHERE workshop_day_id = ? AND status = 'confirmed' ORDER BY created_at DESC")
        .bind(workshopDayId)
    : db.prepare("SELECT * FROM registrations WHERE status = 'confirmed' ORDER BY created_at DESC");
  const { results } = await stmt.all();
  return results;
}

export async function listDonations(db) {
  const { results } = await db.prepare("SELECT * FROM donations ORDER BY created_at DESC").all();
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/lib/db.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db.js test/lib/db.test.js
git commit -m "feat: add D1 query helpers with atomic seat reservation"
```

---

### Task 4: `lib/stripe.js` and `lib/validate.js`

**Files:**
- Create: `lib/stripe.js`
- Create: `lib/validate.js`
- Test: `test/lib/validate.test.js`

**Interfaces:**
- Produces:
  - `getStripeClient(env) -> Stripe` — configured for the Workers runtime.
  - `isValidEmail(email) -> boolean`
  - `requireFields(obj, fieldNames: string[]) -> string[]` — returns a list of
    missing/empty field names (empty array = valid).

- [ ] **Step 1: Write `lib/stripe.js`** (no test — this is a thin, hard-to-unit-test
      factory around the Stripe SDK; correctness is exercised indirectly by every
      test in Tasks 6–7 that calls it)

```js
// lib/stripe.js
import Stripe from "stripe";

export function getStripeClient(env) {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}
```

- [ ] **Step 2: Write the failing tests for `lib/validate.js`**

```js
// test/lib/validate.test.js
import { describe, expect, it } from "vitest";
import { isValidEmail, requireFields } from "../../lib/validate.js";

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("parent@example.com")).toBe(true);
  });

  it("rejects a string with no @", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});

describe("requireFields", () => {
  it("returns an empty array when all fields are present", () => {
    const missing = requireFields({ a: "x", b: "y" }, ["a", "b"]);
    expect(missing).toEqual([]);
  });

  it("lists missing and empty-string fields", () => {
    const missing = requireFields({ a: "x", b: "" }, ["a", "b", "c"]);
    expect(missing).toEqual(["b", "c"]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/lib/validate.test.js`
Expected: FAIL — `lib/validate.js` does not exist yet.

- [ ] **Step 4: Implement `lib/validate.js`**

```js
// lib/validate.js

export function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function requireFields(obj, fieldNames) {
  return fieldNames.filter((name) => {
    const value = obj?.[name];
    return value === undefined || value === null || value === "";
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/lib/validate.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/stripe.js lib/validate.js test/lib/validate.test.js
git commit -m "feat: add Stripe client factory and input validation helpers"
```

---

### Task 5: Public read endpoints — `/api/baskets` and `/api/workshop-days`

**Files:**
- Create: `functions/api/baskets.js`
- Create: `functions/api/workshop-days.js`
- Test: `test/api/baskets.test.js`
- Test: `test/api/workshop-days.test.js`

**Interfaces:**
- Consumes: `getActiveBaskets`, `getUpcomingWorkshopDays` from `lib/db.js` (Task 3).
- Produces: `onRequestGet({env}) -> Response` (JSON array) for each file — later
  used directly by `raffle.html` and `register.html` via `fetch()`.

- [ ] **Step 1: Write the failing test for baskets**

```js
// test/api/baskets.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { insertBasket } from "../../lib/db.js";
import { onRequestGet } from "../../functions/api/baskets.js";

describe("GET /api/baskets", () => {
  it("returns active baskets as JSON", async () => {
    await insertBasket(env.DB, {
      name: "Ticket to Ride Bundle",
      description: "Ticket to Ride + 2 map expansions",
      image_path: "images/baskets/ttr.jpg",
    });

    const response = await onRequestGet({ env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.some((b) => b.name === "Ticket to Ride Bundle")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api/baskets.test.js`
Expected: FAIL — `functions/api/baskets.js` does not exist yet.

- [ ] **Step 3: Implement `functions/api/baskets.js`**

```js
// functions/api/baskets.js
import { getActiveBaskets } from "../../lib/db.js";

export async function onRequestGet({ env }) {
  const baskets = await getActiveBaskets(env.DB);
  return Response.json(baskets);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/api/baskets.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for workshop days**

```js
// test/api/workshop-days.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { insertWorkshopDay } from "../../lib/db.js";
import { onRequestGet } from "../../functions/api/workshop-days.js";

describe("GET /api/workshop-days", () => {
  it("returns upcoming workshop days with seatsRemaining", async () => {
    await insertWorkshopDay(env.DB, {
      title: "February Vacation Workshop",
      eventDate: "2027-02-17",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 20,
    });

    const response = await onRequestGet({ env });
    expect(response.status).toBe(200);
    const body = await response.json();
    const day = body.find((d) => d.title === "February Vacation Workshop");
    expect(day.seatsRemaining).toBe(20);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run test/api/workshop-days.test.js`
Expected: FAIL — `functions/api/workshop-days.js` does not exist yet.

- [ ] **Step 7: Implement `functions/api/workshop-days.js`**

```js
// functions/api/workshop-days.js
import { getUpcomingWorkshopDays } from "../../lib/db.js";

export async function onRequestGet({ env }) {
  const days = await getUpcomingWorkshopDays(env.DB);
  return Response.json(days);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/api/workshop-days.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add functions/api/baskets.js functions/api/workshop-days.js test/api/baskets.test.js test/api/workshop-days.test.js
git commit -m "feat: add public read endpoints for baskets and workshop days"
```

---

### Task 6: `POST /api/checkout` — the core checkout endpoint

This is the most important task in the plan — it's the only place that creates
Stripe Checkout Sessions, for all three product types.

**Files:**
- Create: `functions/api/checkout.js`
- Test: `test/api/checkout.test.js`

**Interfaces:**
- Consumes: `getStripeClient` (Task 4), `getBasketById`, `getWorkshopDayById`,
  `reserveSeat`, `insertPendingRegistration` (Task 3), `isValidEmail`,
  `requireFields` (Task 4).
- Produces: `onRequestPost({request, env}) -> Response` returning
  `{ url: string }` (200) on success, or `{ error: string }` (400/404/409) on
  failure. Later consumed by `raffle.html`, `register.html`, `donate.html`.

Request body shapes:
```
// type: "raffle"
{ type: "raffle", basketId: number, ticketCount: number, donorName: string, donorEmail: string }

// type: "registration"
{ type: "registration", workshopDayId: number, registrationType: "full"|"half",
  childName, childDob, parentName, address, phone, email,
  emergencyContactName, emergencyContactPhone, allergiesMedical,
  waiverAccepted: boolean, waiverSignatureName, photoRelease: boolean }

// type: "donation"
{ type: "donation", amountCents: number, designation: "general"|"sponsor_a_child",
  donorName: string, donorEmail: string }
```

Raffle pricing: `$1 per ticket for 1-5 tickets, $5 flat for 6+ tickets` (the
"6-for-$5" bundle). Implemented as a simple price rule, not a Stripe coupon.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/api/checkout.test.js`
Expected: FAIL — `functions/api/checkout.js` does not exist yet.

- [ ] **Step 3: Implement `functions/api/checkout.js`**

```js
// functions/api/checkout.js
import { getStripeClient } from "../../lib/stripe.js";
import { isValidEmail, requireFields } from "../../lib/validate.js";
import {
  getBasketById,
  getWorkshopDayById,
  reserveSeat,
  insertPendingRegistration,
} from "../../lib/db.js";

function raffleTicketPriceCents(ticketCount) {
  // $1/ticket for 1-5, flat $5 for 6+ ("6 for $5" bundle)
  return ticketCount >= 6 ? 500 : ticketCount * 100;
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

  const day = await getWorkshopDayById(env.DB, body.workshopDayId);
  if (!day) {
    return Response.json({ error: "Workshop day not found" }, { status: 404 });
  }

  const reserved = await reserveSeat(env.DB, body.workshopDayId);
  if (!reserved) {
    return Response.json({ error: "This workshop day is full" }, { status: 409 });
  }

  const priceCents = body.registrationType === "half" ? day.price_half_cents : day.price_full_cents;

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

  switch (body.type) {
    case "raffle":
      return handleRaffle(body, env, origin);
    case "registration":
      return handleRegistration(body, env, origin);
    case "donation":
      return handleDonation(body, env, origin);
    default:
      return Response.json({ error: "Unknown type" }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/api/checkout.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/api/checkout.js test/api/checkout.test.js
git commit -m "feat: add /api/checkout for raffle, registration, and donation flows"
```

---

### Task 7: `POST /api/stripe-webhook` — payment confirmation

**Files:**
- Create: `functions/api/stripe-webhook.js`
- Test: `test/api/stripe-webhook.test.js`

**Interfaces:**
- Consumes: `getStripeClient` (Task 4), `insertRaffleEntry`, `confirmRegistration`,
  `insertDonation` (Task 3).
- Produces: `onRequestPost({request, env}) -> Response`. This is the **only**
  code path in the whole system allowed to write a confirmed row for any of the
  three features.

- [ ] **Step 1: Write the failing tests**

These use Stripe's real signature-generation helper
(`stripe.webhooks.generateTestHeaderStringAsync`) so the test exercises the
actual signature-verification code path, not a mock of it.

```js
// test/api/stripe-webhook.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import Stripe from "stripe";
import { insertBasket, insertWorkshopDay, insertPendingRegistration, getWorkshopDayById } from "../../lib/db.js";
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/api/stripe-webhook.test.js`
Expected: FAIL — `functions/api/stripe-webhook.js` does not exist yet.

- [ ] **Step 3: Implement `functions/api/stripe-webhook.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/api/stripe-webhook.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/api/stripe-webhook.js test/api/stripe-webhook.test.js
git commit -m "feat: add Stripe webhook handler that confirms all three flows"
```

---

### Task 8: `lib/auth.js` and `POST /api/admin/login`

**Files:**
- Create: `lib/auth.js`
- Create: `functions/api/admin/login.js`
- Test: `test/lib/auth.test.js`
- Test: `test/api/admin.test.js` (login portion only — extended in Task 9)

**Interfaces:**
- Produces:
  - `isAuthorized(request, env) -> boolean` — checks the `levelup_admin` cookie
    against `env.ADMIN_TOKEN`.
  - `onRequestPost({request, env}) -> Response` in `login.js` — sets the cookie
    on success.

- [ ] **Step 1: Write the failing test for `lib/auth.js`**

```js
// test/lib/auth.test.js
import { describe, expect, it } from "vitest";
import { isAuthorized } from "../../lib/auth.js";

describe("isAuthorized", () => {
  it("returns true when the cookie matches ADMIN_TOKEN", () => {
    const request = new Request("https://levelupgloucester.org/api/admin/entries", {
      headers: { Cookie: "levelup_admin=secret123" },
    });
    expect(isAuthorized(request, { ADMIN_TOKEN: "secret123" })).toBe(true);
  });

  it("returns false when the cookie is missing", () => {
    const request = new Request("https://levelupgloucester.org/api/admin/entries");
    expect(isAuthorized(request, { ADMIN_TOKEN: "secret123" })).toBe(false);
  });

  it("returns false when the cookie doesn't match", () => {
    const request = new Request("https://levelupgloucester.org/api/admin/entries", {
      headers: { Cookie: "levelup_admin=wrong" },
    });
    expect(isAuthorized(request, { ADMIN_TOKEN: "secret123" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/auth.test.js`
Expected: FAIL — `lib/auth.js` does not exist yet.

- [ ] **Step 3: Implement `lib/auth.js`**

```js
// lib/auth.js

export function isAuthorized(request, env) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const idx = c.indexOf("=");
        return [c.slice(0, idx), c.slice(idx + 1)];
      })
  );
  return Boolean(env.ADMIN_TOKEN) && cookies.levelup_admin === env.ADMIN_TOKEN;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/auth.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for the login endpoint**

```js
// test/api/admin.test.js
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { onRequestPost as loginHandler } from "../../functions/api/admin/login.js";

function loginRequest(password) {
  return new Request("https://levelupgloucester.org/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/admin/login", () => {
  it("sets the admin cookie on the correct password", async () => {
    const response = await loginHandler({
      request: loginRequest("correct-horse"),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toContain("levelup_admin=correct-horse");
    expect(setCookie).toContain("HttpOnly");
  });

  it("rejects the wrong password", async () => {
    const response = await loginHandler({
      request: loginRequest("wrong"),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run test/api/admin.test.js`
Expected: FAIL — `functions/api/admin/login.js` does not exist yet.

- [ ] **Step 7: Implement `functions/api/admin/login.js`**

```js
// functions/api/admin/login.js

export async function onRequestPost({ request, env }) {
  const { password } = await request.json();

  if (!env.ADMIN_TOKEN || password !== env.ADMIN_TOKEN) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `levelup_admin=${env.ADMIN_TOKEN}; HttpOnly; Secure; SameSite=Strict; Max-Age=28800; Path=/`,
    },
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/api/admin.test.js`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add lib/auth.js functions/api/admin/login.js test/lib/auth.test.js test/api/admin.test.js
git commit -m "feat: add shared-password admin login with HttpOnly cookie"
```

---

### Task 9: Admin data endpoints — `entries.js` and `manage.js`

**Files:**
- Create: `functions/api/admin/entries.js`
- Create: `functions/api/admin/manage.js`
- Modify: `test/api/admin.test.js` (append)

**Interfaces:**
- Consumes: `isAuthorized` (Task 8), `listRaffleEntries`, `listRegistrations`,
  `listDonations`, `insertBasket`, `insertWorkshopDay` (Task 3).
- Produces:
  - `GET /api/admin/entries?type=raffle|registrations|donations&format=json|csv`
  - `POST /api/admin/manage` — body `{ kind: "basket"|"workshop_day", ...fields }`

- [ ] **Step 1: Write the failing tests**

```js
// Append to test/api/admin.test.js
import { onRequestGet as entriesHandler } from "../../functions/api/admin/entries.js";
import { onRequestPost as manageHandler } from "../../functions/api/admin/manage.js";
import { insertDonation } from "../../lib/db.js";

function authedRequest(url) {
  return new Request(url, { headers: { Cookie: "levelup_admin=correct-horse" } });
}

describe("GET /api/admin/entries", () => {
  it("rejects an unauthenticated request", async () => {
    const response = await entriesHandler({
      request: new Request("https://levelupgloucester.org/api/admin/entries?type=donations"),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(401);
  });

  it("returns donations as JSON when authenticated", async () => {
    await insertDonation(env.DB, {
      donorName: "Anonymous",
      donorEmail: "donor@example.com",
      amountCents: 4000,
      designation: "sponsor_a_child",
      stripeSessionId: "cs_admin_test_1",
    });

    const response = await entriesHandler({
      request: authedRequest("https://levelupgloucester.org/api/admin/entries?type=donations"),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.some((d) => d.stripe_session_id === "cs_admin_test_1")).toBe(true);
  });

  it("returns CSV when format=csv", async () => {
    const response = await entriesHandler({
      request: authedRequest("https://levelupgloucester.org/api/admin/entries?type=donations&format=csv"),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    const text = await response.text();
    expect(text.split("\n")[0]).toContain("donor_name");
  });
});

describe("POST /api/admin/manage", () => {
  it("creates a basket when authenticated", async () => {
    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({
          kind: "basket",
          name: "Azul Bundle",
          description: "Azul + Stained Glass expansion",
          image_path: "images/baskets/azul.jpg",
        }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/api/admin.test.js`
Expected: FAIL — `entries.js` and `manage.js` don't exist yet.

- [ ] **Step 3: Implement `functions/api/admin/entries.js`**

```js
// functions/api/admin/entries.js
import { isAuthorized } from "../../../lib/auth.js";
import { listRaffleEntries, listRegistrations, listDonations } from "../../../lib/db.js";

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const format = url.searchParams.get("format") ?? "json";

  let rows;
  if (type === "raffle") {
    rows = await listRaffleEntries(env.DB);
  } else if (type === "registrations") {
    rows = await listRegistrations(env.DB);
  } else if (type === "donations") {
    rows = await listDonations(env.DB);
  } else {
    return Response.json({ error: "type must be raffle, registrations, or donations" }, { status: 400 });
  }

  if (format === "csv") {
    return new Response(toCsv(rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  return Response.json(rows);
}
```

- [ ] **Step 4: Implement `functions/api/admin/manage.js`**

```js
// functions/api/admin/manage.js
import { isAuthorized } from "../../../lib/auth.js";
import { requireFields } from "../../../lib/validate.js";
import { insertBasket, insertWorkshopDay } from "../../../lib/db.js";

export async function onRequestPost({ request, env }) {
  if (!isAuthorized(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (body.kind === "basket") {
    const missing = requireFields(body, ["name", "description", "image_path"]);
    if (missing.length > 0) {
      return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
    const result = await insertBasket(env.DB, body);
    return Response.json(result);
  }

  if (body.kind === "workshop_day") {
    const missing = requireFields(body, [
      "title",
      "eventDate",
      "location",
      "priceFullCents",
      "priceHalfCents",
      "capacity",
    ]);
    if (missing.length > 0) {
      return Response.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
    const result = await insertWorkshopDay(env.DB, body);
    return Response.json(result);
  }

  return Response.json({ error: "kind must be basket or workshop_day" }, { status: 400 });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/api/admin.test.js`
Expected: PASS (6 tests total)

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin/entries.js functions/api/admin/manage.js test/api/admin.test.js
git commit -m "feat: add admin data listing/CSV export and basket/workshop-day management"
```

---

### Task 10: Extract shared design system into `assets/site.css`

**Files:**
- Create: `assets/site.css`
- Read (do not modify): `index.html` (source of the tokens/classes being extracted)

**Interfaces:**
- Produces: CSS custom properties and component classes (`.container`, `.btn`,
  `.program-card`, header/nav, footer, typography) that `raffle.html`,
  `register.html`, `donate.html`, and `admin.html` all link to via
  `<link rel="stylesheet" href="assets/site.css">`.

- [ ] **Step 1: Copy the shared design tokens and component styles**

Open `index.html` and copy the `:root` custom properties block, the Reset &
Base Styles section, Typography, Layout & Containers, Header & Navigation,
Buttons & CTAs, and Programs Section (`.program-card` and friends) rules
verbatim into a new file — this is a copy, not a rewrite, so the four new pages
render identically to the existing site's visual language.

```css
/* assets/site.css — shared design tokens and components, extracted from
   index.html so raffle.html / register.html / donate.html / admin.html don't
   each duplicate ~500 lines of inline <style>. index.html itself is left
   untouched and keeps its own inline copy. */

:root {
    --color-white: #ffffff;
    --color-blue: #226e93;
    --color-gray: #8c8c8c;
    --color-dark: #212121;
    --color-bg-light: #fafafa;
    --font-family: 'Lato', sans-serif;
    --header-height: 120px;
    --spacing-section: 6rem;
    --container-width: 1200px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html { scroll-behavior: smooth; scroll-padding-top: var(--header-height); }

body {
    font-family: var(--font-family);
    color: var(--color-dark);
    background-color: var(--color-white);
    line-height: 1.6;
    padding-top: var(--header-height);
    -webkit-font-smoothing: antialiased;
}

img { max-width: 100%; height: auto; display: block; object-fit: cover; }
a { text-decoration: none; color: inherit; transition: color 0.3s ease; }

h1, h2, h3, h4 { line-height: 1.2; font-weight: 700; margin-bottom: 1rem; color: var(--color-dark); }
h1 { font-size: clamp(2.5rem, 5vw, 4rem); font-weight: 900; letter-spacing: -0.02em; }
h2 { font-size: clamp(2rem, 4vw, 3rem); position: relative; padding-bottom: 1rem; margin-bottom: 3rem; }
h2::after { content: ''; position: absolute; left: 0; bottom: 0; width: 60px; height: 4px; background-color: var(--color-blue); }
h3 { font-size: 1.5rem; margin-bottom: 0.5rem; }
p { font-size: 1.125rem; margin-bottom: 1.5rem; color: var(--color-dark); opacity: 0.9; }

.container { width: 100%; max-width: var(--container-width); margin: 0 auto; padding: 0 2rem; }
section { padding: var(--spacing-section) 0; position: relative; }
.bg-light { background-color: var(--color-bg-light); border-top: 1px solid rgba(140, 140, 140, 0.1); border-bottom: 1px solid rgba(140, 140, 140, 0.1); }

header {
    position: fixed; top: 0; left: 0; width: 100%; height: var(--header-height);
    background-color: rgba(255, 255, 255, 0.98);
    border-bottom: 1px solid rgba(140, 140, 140, 0.2);
    z-index: 300; display: flex; align-items: center;
}
.header-inner { display: flex; justify-content: space-between; align-items: center; height: 100%; }
.logo { font-size: 1.5rem; font-weight: 900; color: var(--color-blue); letter-spacing: -0.02em; text-transform: uppercase; }
nav { display: flex; gap: 2.5rem; }
nav a { font-weight: 700; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; position: relative; }

.btn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 1rem 2.5rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    background-color: var(--color-blue); color: var(--color-white);
    border: 2px solid var(--color-blue); transition: all 0.3s ease; cursor: pointer;
}
.btn:hover { background-color: transparent; color: var(--color-blue); }

.link-secondary { display: inline-block; margin-top: 1rem; font-weight: 700; font-size: 0.9rem; color: var(--color-blue); border-bottom: 1px solid transparent; }
.link-secondary:hover { border-bottom-color: var(--color-blue); }

.program-card {
    background-color: var(--color-white); padding: 3rem;
    border: 1px solid rgba(140, 140, 140, 0.2); position: relative;
    transition: transform 0.4s ease, box-shadow 0.4s ease;
    display: flex; flex-direction: column;
}
.program-card:hover { transform: translateY(-5px); box-shadow: 0 20px 40px rgba(33, 33, 33, 0.05); }
.program-card h3 { color: var(--color-blue); margin-bottom: 1.5rem; }
.program-card p { margin-bottom: 0; font-size: 1rem; flex-grow: 1; }

footer { background-color: var(--color-dark); color: var(--color-white); padding: 5rem 0 3rem; }
footer a, footer p { color: var(--color-gray); }
footer a:hover { color: var(--color-white); }

/* Form elements — new for the four pages that use this stylesheet */
.form-field { margin-bottom: 1.5rem; }
.form-field label { display: block; font-weight: 700; margin-bottom: 0.5rem; font-size: 0.95rem; }
.form-field input[type="text"],
.form-field input[type="email"],
.form-field input[type="tel"],
.form-field input[type="date"],
.form-field input[type="number"],
.form-field select,
.form-field textarea {
    width: 100%; padding: 0.75rem 1rem; font-family: var(--font-family); font-size: 1rem;
    border: 1px solid rgba(140, 140, 140, 0.4); background: var(--color-white);
}
.form-field.checkbox { display: flex; align-items: flex-start; gap: 0.75rem; }
.form-error { color: #b3261e; font-weight: 700; margin-bottom: 1rem; }

@media (max-width: 768px) {
    nav { display: none; }
    h1 { font-size: 2.5rem; }
}
```

- [ ] **Step 2: Commit**

```bash
git add assets/site.css
git commit -m "feat: extract shared design system into assets/site.css for new pages"
```

---

### Task 11: `raffle.html` and `raffle-success.html`

**Files:**
- Create: `raffle.html`
- Create: `raffle-success.html`

**Interfaces:**
- Consumes: `GET /api/baskets` (Task 5), `POST /api/checkout` with `type: "raffle"`
  (Task 6).

- [ ] **Step 1: Write `raffle.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Holiday Basket Sweepstakes | Level Up Gloucester</title>
    <meta name="description" content="Enter Level Up Gloucester's holiday board-game basket sweepstakes. No purchase necessary.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
</head>
<body>
    <header>
        <div class="container header-inner">
            <a href="index.html" class="logo"><img src="images/logo.png" alt="Level Up Gloucester" style="height:100px;width:auto;display:block;"></a>
            <nav>
                <a href="index.html#about">About</a>
                <a href="register.html">Workshop Days</a>
                <a href="raffle.html">Raffle</a>
                <a href="donate.html">Donate</a>
                <a href="index.html#contact">Contact</a>
            </nav>
        </div>
    </header>

    <main>
        <section class="hero">
            <div class="container">
                <h1>Holiday Basket Sweepstakes</h1>
                <p class="lead">Choose a basket, then enter for your chance to win. Entries are $1 each, or 6 for $5. <strong>No purchase is necessary to enter or win</strong> — see "Enter Free" below.</p>
            </div>
        </section>

        <section id="baskets" class="bg-light">
            <div class="container">
                <h2>This Year's Baskets</h2>
                <div id="basket-grid" class="programs-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:2rem;"></div>
            </div>
        </section>

        <section id="enter">
            <div class="container">
                <h2>Enter to Win</h2>
                <div id="form-error" class="form-error" hidden></div>
                <form id="entry-form">
                    <div class="form-field">
                        <label for="basketId">Which basket?</label>
                        <select id="basketId" name="basketId" required></select>
                    </div>
                    <div class="form-field">
                        <label for="ticketCount">How many entries? ($1 each, 6 for $5)</label>
                        <input type="number" id="ticketCount" name="ticketCount" min="1" value="1" required>
                    </div>
                    <div class="form-field">
                        <label for="donorName">Your name</label>
                        <input type="text" id="donorName" name="donorName" required>
                    </div>
                    <div class="form-field">
                        <label for="donorEmail">Your email</label>
                        <input type="email" id="donorEmail" name="donorEmail" required>
                    </div>
                    <button type="submit" class="btn">Continue to Payment &rarr;</button>
                </form>
            </div>
        </section>

        <section id="enter-free" class="bg-light">
            <div class="container">
                <h2>Enter Free by Mail</h2>
                <p>No purchase is necessary to enter or win. To enter without donating, mail a 3&times;5 card with your full name, mailing address, email, phone number, and the name of the basket you'd like to enter to:</p>
                <p><strong>Level Up Inc.</strong><br>Attn: Holiday Sweepstakes<br>Gloucester, MA</p>
                <p>Limit one free mail-in entry per person/household per basket. Mailed entries must be received before the drawing date and receive the average number of entries earned by paid entrants for that basket, rounded up.</p>
            </div>
        </section>

        <section id="official-rules">
            <div class="container">
                <h2>Official Rules</h2>
                <p><strong>NO PURCHASE, DONATION, OR PAYMENT OF ANY KIND IS NECESSARY TO ENTER OR WIN. A donation will not increase your odds of winning relative to other paid entries, beyond the number of entries purchased.</strong></p>
                <p><strong>Sponsor:</strong> Level Up Inc., a Massachusetts nonprofit corporation, Gloucester, MA.</p>
                <p><strong>Eligibility:</strong> Open to legal residents of Massachusetts 18 years of age or older. Void where prohibited.</p>
                <p><strong>How to Enter:</strong> Purchase one or more $1 entries (or a 6-for-$5 bundle) at levelupgloucester.org/raffle.html, choosing the basket you wish to enter, OR enter free by mail as described above. Limit one free entry per person/household per basket.</p>
                <p><strong>Odds of Winning:</strong> Depend on the total number of eligible entries received for each basket.</p>
                <p><strong>Winner Selection:</strong> One winner per basket will be drawn at random from all eligible entries for that basket on the drawing date announced on this page. Winners will be notified by the email or phone number provided at entry within 30 days of the drawing and must respond within 7 days to claim their prize or it will be forfeited and re-drawn.</p>
                <p><strong>Prizes:</strong> Each basket is described on this page along with its approximate retail value. Level Up Inc. reserves the right to substitute a prize of equal or greater value. Prizes are provided as-is with no warranty.</p>
                <p><strong>Governing Law:</strong> This sweepstakes is governed by the laws of the Commonwealth of Massachusetts.</p>
                <p><em>This section will be finalized with the actual drawing date before entries open — do not publish live until reviewed.</em></p>
            </div>
        </section>
    </main>

    <footer id="contact">
        <div class="container">
            <p>&copy; Level Up Inc. | levelupgloucester@gmail.com</p>
        </div>
    </footer>

    <script>
        async function loadBaskets() {
            const response = await fetch("/api/baskets");
            const baskets = await response.json();

            const grid = document.getElementById("basket-grid");
            grid.innerHTML = baskets
                .map(
                    (b) => `
                    <div class="program-card">
                        <img src="${b.image_path}" alt="${b.name}" style="margin-bottom:1.5rem;">
                        <h3>${b.name}</h3>
                        <p>${b.description}</p>
                    </div>`
                )
                .join("");

            const select = document.getElementById("basketId");
            select.innerHTML = baskets.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
        }

        document.getElementById("entry-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const errorBox = document.getElementById("form-error");
            errorBox.hidden = true;

            const body = {
                type: "raffle",
                basketId: Number(document.getElementById("basketId").value),
                ticketCount: Number(document.getElementById("ticketCount").value),
                donorName: document.getElementById("donorName").value,
                donorEmail: document.getElementById("donorEmail").value,
            };

            const response = await fetch("/api/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await response.json();

            if (!response.ok) {
                errorBox.textContent = result.error || "Something went wrong. Please try again.";
                errorBox.hidden = false;
                return;
            }

            window.location.href = result.url;
        });

        loadBaskets();
    </script>
</body>
</html>
```

- [ ] **Step 2: Write `raffle-success.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thank You | Level Up Gloucester</title>
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
</head>
<body>
    <main>
        <section class="container" style="padding-top:4rem;text-align:center;">
            <h1>Thank You!</h1>
            <p>Your raffle entry is confirmed. Good luck — winners will be contacted directly by email or phone.</p>
            <a href="index.html" class="btn">Back to Home</a>
        </section>
    </main>
</body>
</html>
```

- [ ] **Step 3: Manual verification**

Run: `npm run migrate:local && npm run dev`
Visit `http://localhost:8788/raffle.html`. Confirm the page loads (basket grid
will be empty until Task 12's seed data step / manual basket creation via
`/api/admin/manage`), the form renders, and submitting without required fields
shows native browser validation.

- [ ] **Step 4: Commit**

```bash
git add raffle.html raffle-success.html
git commit -m "feat: add raffle entry page and success page"
```

---

### Task 12: `register.html` and `register-success.html`

**Files:**
- Create: `register.html`
- Create: `register-success.html`

**Interfaces:**
- Consumes: `GET /api/workshop-days` (Task 5), `POST /api/checkout` with
  `type: "registration"` (Task 6).
- Waiver copy and field set taken directly from
  `Legal & Governance/Liability_Waiver.md`.

- [ ] **Step 1: Write `register.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Register for a Workshop Day | Level Up Gloucester</title>
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
</head>
<body>
    <header>
        <div class="container header-inner">
            <a href="index.html" class="logo"><img src="images/logo.png" alt="Level Up Gloucester" style="height:100px;width:auto;display:block;"></a>
            <nav>
                <a href="index.html#about">About</a>
                <a href="register.html">Workshop Days</a>
                <a href="raffle.html">Raffle</a>
                <a href="donate.html">Donate</a>
                <a href="index.html#contact">Contact</a>
            </nav>
        </div>
    </header>

    <main>
        <section class="hero">
            <div class="container">
                <h1>Register for a Workshop Day</h1>
                <p class="lead">Full-day and half-day options. If cost is a barrier for your family, email us at <a href="mailto:levelupgloucester@gmail.com">levelupgloucester@gmail.com</a> before registering and we'll work something out quietly.</p>
            </div>
        </section>

        <section id="form-error-section" class="bg-light" hidden>
            <div class="container"><div id="form-error" class="form-error"></div></div>
        </section>

        <section>
            <div class="container">
                <form id="registration-form">
                    <div class="form-field">
                        <label for="workshopDayId">Which workshop day?</label>
                        <select id="workshopDayId" name="workshopDayId" required></select>
                    </div>
                    <div class="form-field">
                        <label for="registrationType">Full day or half day?</label>
                        <select id="registrationType" name="registrationType" required>
                            <option value="full">Full day</option>
                            <option value="half">Half day</option>
                        </select>
                    </div>

                    <h3>Participant Information</h3>
                    <div class="form-field"><label for="childName">Child's full name</label><input type="text" id="childName" required></div>
                    <div class="form-field"><label for="childDob">Child's date of birth</label><input type="date" id="childDob" required></div>
                    <div class="form-field"><label for="parentName">Parent/guardian full name</label><input type="text" id="parentName" required></div>
                    <div class="form-field"><label for="address">Home address</label><input type="text" id="address" required></div>
                    <div class="form-field"><label for="phone">Phone</label><input type="tel" id="phone" required></div>
                    <div class="form-field"><label for="email">Email</label><input type="email" id="email" required></div>
                    <div class="form-field"><label for="emergencyContactName">Emergency contact name</label><input type="text" id="emergencyContactName" required></div>
                    <div class="form-field"><label for="emergencyContactPhone">Emergency contact phone</label><input type="tel" id="emergencyContactPhone" required></div>
                    <div class="form-field"><label for="allergiesMedical">Allergies or medical conditions we should know about</label><textarea id="allergiesMedical"></textarea></div>

                    <h3>Assumption of Risk &amp; Release of Liability</h3>
                    <p>I understand that my child will be participating in tabletop gaming activities (board games, card games, and role playing games such as Dungeons &amp; Dragons) supervised by Level Up Inc. staff and volunteers. While these are low-physical-risk activities, I understand that any group activity carries some inherent risk, including minor injury, illness, or property loss. In consideration of my child being permitted to participate, I assume all ordinary risks; release and hold harmless Level Up Inc., its directors, officers, employees, and volunteers, and the event venue, from any and all claims, liability, or expenses arising from my child's participation, except in cases of gross negligence or willful misconduct; authorize Level Up Inc. staff to seek emergency medical treatment for my child if I cannot be reached immediately, agreeing to be responsible for any resulting medical costs; and confirm the information provided above is accurate.</p>
                    <div class="form-field checkbox">
                        <input type="checkbox" id="waiverAccepted" required>
                        <label for="waiverAccepted">I have read and agree to the above.</label>
                    </div>
                    <div class="form-field">
                        <label for="waiverSignatureName">Type your full name as your signature</label>
                        <input type="text" id="waiverSignatureName" required>
                    </div>

                    <h3>Photo &amp; Video Release</h3>
                    <div class="form-field checkbox">
                        <input type="checkbox" id="photoRelease">
                        <label for="photoRelease">I give Level Up Inc. permission to use photos or video of my child taken during this event for the organization's website, social media, and promotional materials. (Optional — leave unchecked to decline.)</label>
                    </div>

                    <button type="submit" class="btn">Continue to Payment &rarr;</button>
                </form>
            </div>
        </section>
    </main>

    <footer id="contact">
        <div class="container">
            <p>&copy; Level Up Inc. | levelupgloucester@gmail.com</p>
        </div>
    </footer>

    <script>
        async function loadWorkshopDays() {
            const response = await fetch("/api/workshop-days");
            const days = await response.json();
            const select = document.getElementById("workshopDayId");
            select.innerHTML = days
                .map(
                    (d) =>
                        `<option value="${d.id}">${d.title} — ${d.event_date} (${d.seatsRemaining} seats left)</option>`
                )
                .join("");
        }

        document.getElementById("registration-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const errorSection = document.getElementById("form-error-section");
            const errorBox = document.getElementById("form-error");
            errorSection.hidden = true;

            const body = {
                type: "registration",
                workshopDayId: Number(document.getElementById("workshopDayId").value),
                registrationType: document.getElementById("registrationType").value,
                childName: document.getElementById("childName").value,
                childDob: document.getElementById("childDob").value,
                parentName: document.getElementById("parentName").value,
                address: document.getElementById("address").value,
                phone: document.getElementById("phone").value,
                email: document.getElementById("email").value,
                emergencyContactName: document.getElementById("emergencyContactName").value,
                emergencyContactPhone: document.getElementById("emergencyContactPhone").value,
                allergiesMedical: document.getElementById("allergiesMedical").value,
                waiverAccepted: document.getElementById("waiverAccepted").checked,
                waiverSignatureName: document.getElementById("waiverSignatureName").value,
                photoRelease: document.getElementById("photoRelease").checked,
            };

            const response = await fetch("/api/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await response.json();

            if (!response.ok) {
                errorBox.textContent = result.error || "Something went wrong. Please try again.";
                errorSection.hidden = false;
                return;
            }

            window.location.href = result.url;
        });

        loadWorkshopDays();
    </script>
</body>
</html>
```

- [ ] **Step 2: Write `register-success.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Registration Confirmed | Level Up Gloucester</title>
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
</head>
<body>
    <main>
        <section class="container" style="padding-top:4rem;text-align:center;">
            <h1>You're Registered!</h1>
            <p>Thanks for signing up — a confirmation has been sent to your email. See you at the workshop day!</p>
            <a href="index.html" class="btn">Back to Home</a>
        </section>
    </main>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add register.html register-success.html
git commit -m "feat: add workshop-day registration page and success page"
```

---

### Task 13: `donate.html` and `donate-success.html`

**Files:**
- Create: `donate.html`
- Create: `donate-success.html`

**Interfaces:**
- Consumes: `POST /api/checkout` with `type: "donation"` (Task 6).

- [ ] **Step 1: Write `donate.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Donate | Level Up Gloucester</title>
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
</head>
<body>
    <header>
        <div class="container header-inner">
            <a href="index.html" class="logo"><img src="images/logo.png" alt="Level Up Gloucester" style="height:100px;width:auto;display:block;"></a>
            <nav>
                <a href="index.html#about">About</a>
                <a href="register.html">Workshop Days</a>
                <a href="raffle.html">Raffle</a>
                <a href="donate.html">Donate</a>
                <a href="index.html#contact">Contact</a>
            </nav>
        </div>
    </header>

    <main>
        <section class="hero">
            <div class="container">
                <h1>Support Level Up Gloucester</h1>
                <p class="lead">Level Up Inc. is a Massachusetts nonprofit corporation. Our 501(c)(3) federal tax-exempt determination is pending — donations are not currently tax-deductible.</p>
            </div>
        </section>

        <section>
            <div class="container">
                <div id="form-error" class="form-error" hidden></div>
                <form id="donate-form">
                    <div class="form-field">
                        <label for="amount">Amount</label>
                        <select id="amount">
                            <option value="4000">$40 — sponsors a half-day for a child</option>
                            <option value="6500">$65 — sponsors a full day for a child</option>
                            <option value="custom">Custom amount</option>
                        </select>
                    </div>
                    <div class="form-field" id="custom-amount-field" hidden>
                        <label for="customAmount">Custom amount (USD)</label>
                        <input type="number" id="customAmount" min="1" step="1">
                    </div>
                    <div class="form-field checkbox">
                        <input type="checkbox" id="sponsorAChild">
                        <label for="sponsorAChild">Earmark my donation to sponsor another child's registration.</label>
                    </div>
                    <div class="form-field">
                        <label for="donorName">Your name</label>
                        <input type="text" id="donorName" required>
                    </div>
                    <div class="form-field">
                        <label for="donorEmail">Your email</label>
                        <input type="email" id="donorEmail" required>
                    </div>
                    <button type="submit" class="btn">Continue to Payment &rarr;</button>
                </form>
            </div>
        </section>
    </main>

    <footer id="contact">
        <div class="container">
            <p>&copy; Level Up Inc. | levelupgloucester@gmail.com</p>
        </div>
    </footer>

    <script>
        const amountSelect = document.getElementById("amount");
        const customField = document.getElementById("custom-amount-field");
        amountSelect.addEventListener("change", () => {
            customField.hidden = amountSelect.value !== "custom";
        });

        document.getElementById("donate-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const errorBox = document.getElementById("form-error");
            errorBox.hidden = true;

            const amountCents =
                amountSelect.value === "custom"
                    ? Math.round(Number(document.getElementById("customAmount").value) * 100)
                    : Number(amountSelect.value);

            const body = {
                type: "donation",
                amountCents,
                designation: document.getElementById("sponsorAChild").checked ? "sponsor_a_child" : "general",
                donorName: document.getElementById("donorName").value,
                donorEmail: document.getElementById("donorEmail").value,
            };

            const response = await fetch("/api/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await response.json();

            if (!response.ok) {
                errorBox.textContent = result.error || "Something went wrong. Please try again.";
                errorBox.hidden = false;
                return;
            }

            window.location.href = result.url;
        });
    </script>
</body>
</html>
```

- [ ] **Step 2: Write `donate-success.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thank You | Level Up Gloucester</title>
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
</head>
<body>
    <main>
        <section class="container" style="padding-top:4rem;text-align:center;">
            <h1>Thank You!</h1>
            <p>Your generosity helps every kid in Gloucester have a place to belong.</p>
            <a href="index.html" class="btn">Back to Home</a>
        </section>
    </main>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add donate.html donate-success.html
git commit -m "feat: add donation page with sponsor-a-child designation"
```

---

### Task 14: `admin.html`

**Files:**
- Create: `admin.html`

**Interfaces:**
- Consumes: `POST /api/admin/login` (Task 8), `GET /api/admin/entries` (Task 9),
  `POST /api/admin/manage` (Task 9).

- [ ] **Step 1: Write `admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin | Level Up Gloucester</title>
    <meta name="robots" content="noindex, nofollow">
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
</head>
<body>
    <main>
        <section class="container" style="padding-top:3rem;">
            <h1>Level Up Admin</h1>

            <div id="login-panel">
                <div class="form-field"><label for="password">Admin password</label><input type="password" id="password"></div>
                <button id="login-btn" class="btn">Log In</button>
                <p id="login-error" class="form-error" hidden></p>
            </div>

            <div id="dashboard" hidden>
                <h2>Raffle Entries <a href="/api/admin/entries?type=raffle&format=csv" download>Download CSV</a></h2>
                <div id="raffle-table"></div>

                <h2>Registrations <a href="/api/admin/entries?type=registrations&format=csv" download>Download CSV</a></h2>
                <div id="registrations-table"></div>

                <h2>Donations <a href="/api/admin/entries?type=donations&format=csv" download>Download CSV</a></h2>
                <div id="donations-table"></div>

                <h2>Add a Basket</h2>
                <form id="basket-form">
                    <div class="form-field"><label for="b-name">Name</label><input type="text" id="b-name" required></div>
                    <div class="form-field"><label for="b-desc">Description</label><input type="text" id="b-desc" required></div>
                    <div class="form-field"><label for="b-image">Image path (e.g. images/baskets/catan.jpg — commit the file first)</label><input type="text" id="b-image" required></div>
                    <button type="submit" class="btn">Add Basket</button>
                </form>

                <h2>Add a Workshop Day</h2>
                <form id="workshop-form">
                    <div class="form-field"><label for="w-title">Title</label><input type="text" id="w-title" required></div>
                    <div class="form-field"><label for="w-date">Date</label><input type="date" id="w-date" required></div>
                    <div class="form-field"><label for="w-location">Location</label><input type="text" id="w-location" required></div>
                    <div class="form-field"><label for="w-full">Full-day price (USD)</label><input type="number" id="w-full" value="65" required></div>
                    <div class="form-field"><label for="w-half">Half-day price (USD)</label><input type="number" id="w-half" value="40" required></div>
                    <div class="form-field"><label for="w-capacity">Capacity</label><input type="number" id="w-capacity" required></div>
                    <button type="submit" class="btn">Add Workshop Day</button>
                </form>
            </div>
        </section>
    </main>

    <script>
        function renderTable(containerId, rows) {
            const container = document.getElementById(containerId);
            if (rows.length === 0) {
                container.textContent = "None yet.";
                return;
            }
            const headers = Object.keys(rows[0]);
            const table = document.createElement("table");
            table.style.width = "100%";
            table.style.borderCollapse = "collapse";
            table.innerHTML =
                `<thead><tr>${headers.map((h) => `<th style="text-align:left;border-bottom:1px solid #ccc;padding:0.5rem;">${h}</th>`).join("")}</tr></thead>` +
                `<tbody>${rows
                    .map(
                        (r) =>
                            `<tr>${headers.map((h) => `<td style="padding:0.5rem;border-bottom:1px solid #eee;">${r[h] ?? ""}</td>`).join("")}</tr>`
                    )
                    .join("")}</tbody>`;
            container.innerHTML = "";
            container.appendChild(table);
        }

        async function loadDashboard() {
            for (const [type, containerId] of [
                ["raffle", "raffle-table"],
                ["registrations", "registrations-table"],
                ["donations", "donations-table"],
            ]) {
                const response = await fetch(`/api/admin/entries?type=${type}`);
                if (response.ok) renderTable(containerId, await response.json());
            }
        }

        document.getElementById("login-btn").addEventListener("click", async () => {
            const password = document.getElementById("password").value;
            const response = await fetch("/api/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!response.ok) {
                document.getElementById("login-error").hidden = false;
                document.getElementById("login-error").textContent = "Incorrect password.";
                return;
            }
            document.getElementById("login-panel").hidden = true;
            document.getElementById("dashboard").hidden = false;
            loadDashboard();
        });

        document.getElementById("basket-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            await fetch("/api/admin/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    kind: "basket",
                    name: document.getElementById("b-name").value,
                    description: document.getElementById("b-desc").value,
                    image_path: document.getElementById("b-image").value,
                }),
            });
            e.target.reset();
            alert("Basket added.");
        });

        document.getElementById("workshop-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            await fetch("/api/admin/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    kind: "workshop_day",
                    title: document.getElementById("w-title").value,
                    eventDate: document.getElementById("w-date").value,
                    location: document.getElementById("w-location").value,
                    priceFullCents: Math.round(Number(document.getElementById("w-full").value) * 100),
                    priceHalfCents: Math.round(Number(document.getElementById("w-half").value) * 100),
                    capacity: Number(document.getElementById("w-capacity").value),
                }),
            });
            e.target.reset();
            loadDashboard();
            alert("Workshop day added.");
        });
    </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add admin.html
git commit -m "feat: add admin dashboard for entries, registrations, donations, and basket/workshop-day management"
```

---

### Task 15: Local end-to-end smoke test with the Stripe CLI

This task has no new source files — it's a manual verification pass proving
the whole system works together locally, in Stripe test mode, before touching
production.

**Files:** none (verification only)

- [ ] **Step 1: Install the Stripe CLI and log in**

Follow `https://docs.stripe.com/stripe-cli` to install, then run:
```bash
stripe login
```

- [ ] **Step 2: Create a `.dev.vars` file with test-mode secrets**

```bash
# .dev.vars (already gitignored by Task 1 — never commit this file)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # filled in from Step 3's CLI output
ADMIN_TOKEN=pick-a-strong-password
```
Get `sk_test_...` from the Stripe Dashboard (test mode) API keys page.

- [ ] **Step 3: Forward webhooks to the local dev server**

In one terminal:
```bash
npm run migrate:local
npm run dev
```
In a second terminal:
```bash
stripe listen --forward-to localhost:8788/api/stripe-webhook
```
Copy the `whsec_...` value it prints into `.dev.vars` from Step 2, then restart
`npm run dev`.

- [ ] **Step 4: Seed one basket and one workshop day via the admin UI**

Visit `http://localhost:8788/admin.html`, log in with the `ADMIN_TOKEN` from
`.dev.vars`, and add one basket and one workshop day using the forms built in
Task 14.

- [ ] **Step 5: Walk all three checkout flows with Stripe test cards**

Visit `raffle.html`, `register.html`, and `donate.html` in turn. Use Stripe's
test card `4242 4242 4242 4242`, any future expiry, any CVC. After each
successful payment, confirm:
- The `stripe listen` terminal shows a `checkout.session.completed` event
  forwarded with a `200` response from the local server.
- `admin.html`'s dashboard shows the new row after a refresh.

- [ ] **Step 6: Verify the capacity limit**

Set the seeded workshop day's capacity to 0 directly in the local D1 database:
```bash
npx wrangler d1 execute levelup-payments --local --command "UPDATE workshop_days SET capacity = 0 WHERE id = 1"
```
Attempt to register — confirm the page surfaces the "This workshop day is
full" error instead of proceeding to Stripe.

- [ ] **Step 7: No commit for this task** — it's a verification pass. If any
step above reveals a bug, fix it in the relevant task's files and commit that
fix with a message like `fix: <what was wrong>`, referencing which task it
belongs to.

---

### Task 16: Production deployment and DNS cutover

**Files:** none (infrastructure/ops only)

This task goes live — the last two steps switch real payments on and move the
production domain. Do not run Step 8 onward without Steve's explicit go-ahead,
per the design spec's "Steve reviews before anything goes live" requirement —
this includes the Official Rules text in `raffle.html` (Task 11) and the waiver
text in `register.html` (Task 12), which must be reviewed before Step 8.

- [ ] **Step 1: Create the Cloudflare Pages project**

In the Cloudflare dashboard: Workers & Pages → Create → Pages → Connect to Git
→ select the `levelupgloucester-website` repo. Build settings: no build
command, output directory `/`.

- [ ] **Step 2: Bind the D1 database to the Pages project**

In the Pages project's Settings → Functions → D1 database bindings, add
binding name `DB` pointing at the `levelup-payments` database created in
Task 1.

- [ ] **Step 3: Apply migrations to the remote database**

```bash
npm run migrate:remote
```

- [ ] **Step 4: Create the live Stripe account and get live-mode keys**

Set up (or switch to live mode on) the Stripe account for Level Up Inc. Get the
live `sk_live_...` secret key from the Stripe Dashboard.

- [ ] **Step 5: Set Cloudflare Pages secrets (test mode first)**

```bash
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name levelup-website
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name levelup-website
npx wrangler pages secret put ADMIN_TOKEN --project-name levelup-website
```
Use the **test-mode** Stripe secret key for this first pass.

- [ ] **Step 6: Register the production webhook endpoint in Stripe (test mode)**

In the Stripe Dashboard (test mode) → Developers → Webhooks → Add endpoint:
`https://<pages-project>.pages.dev/api/stripe-webhook`, event:
`checkout.session.completed`. Copy the resulting signing secret and update the
`STRIPE_WEBHOOK_SECRET` secret from Step 5 to match.

- [ ] **Step 7: Full test-mode walkthrough on the deployed Pages URL**

Repeat Task 15's Steps 4–6 against the real deployed
`https://<pages-project>.pages.dev` URL instead of localhost, confirming all
three flows work end-to-end in the cloud before going live.

- [ ] **Step 8: STOP — get Steve's explicit sign-off**

Confirm with Steve that: the Official Rules text in `raffle.html` and the
waiver text in `register.html` have been reviewed and approved, and the actual
holiday-raffle drawing date and final basket list/photos are ready. Do not
proceed past this point without that confirmation.

- [ ] **Step 9: Switch to live-mode Stripe keys**

```bash
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name levelup-website
```
Enter the `sk_live_...` key this time. Register a new webhook endpoint in
Stripe **live mode** pointing at the same URL, and update
`STRIPE_WEBHOOK_SECRET` to that live-mode signing secret.

- [ ] **Step 10: DNS cutover**

In Squarespace Domains DNS settings for `levelupgloucester.org`, change the
`www` CNAME record from `herocomplex82.github.io` (GitHub Pages) to the
Cloudflare Pages target shown in the Pages project's Custom Domains setup
screen. Add the custom domain in the Cloudflare Pages dashboard first — it
will show the exact target value and confirm once DNS propagates.

- [ ] **Step 11: Verify production**

Visit `https://www.levelupgloucester.org/raffle.html` (and `/register.html`,
`/donate.html`) and confirm they load over the production domain with a valid
SSL certificate.

---

## Self-Review Notes

- **Spec coverage:** Every feature in the design spec (raffle sweepstakes,
  workshop registration with waiver reuse, donations with sponsor-a-child,
  admin view with CSV export, Stripe-direct payments, Cloudflare Pages/D1
  hosting, capacity-limit race-condition handling, no-tax-deductibility
  language) has a corresponding task above.
- **Added beyond the letter of the spec, but necessary to operate it:** public
  `GET /api/baskets` and `GET /api/workshop-days` endpoints (the spec's pages
  needed *some* way to list this data), and basic basket/workshop-day creation
  in the admin view (the spec never said how Steve adds a basket or a workshop
  day otherwise).
- **Known limitation, deliberately not solved here (documented, not
  hand-waved):** a seat reserved via `reserveSeat` at checkout time is never
  released if the visitor abandons Stripe Checkout without paying — over time
  this could make a workshop day appear falsely full. Fixing this needs a
  reservation-expiry mechanism (e.g., a scheduled Cloudflare Cron Trigger that
  releases pending registrations older than 30 minutes), which is a
  reasonable v2 addition once real usage shows it's actually a problem — not
  built now, to avoid scope creep beyond what the spec asked for.
