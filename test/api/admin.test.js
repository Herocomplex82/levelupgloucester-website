import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { onRequestPost as loginHandler } from "../../functions/api/admin/login.js";
import { onRequestGet as entriesHandler } from "../../functions/api/admin/entries.js";
import { onRequestPost as manageHandler } from "../../functions/api/admin/manage.js";
import { insertDonation, insertBasket, insertWorkshopDay } from "../../lib/db.js";

function authedRequest(url) {
  return new Request(url, { headers: { Cookie: "levelup_admin=correct-horse" } });
}

function loginRequest(password, ip = "203.0.113.1") {
  return new Request("https://levelupgloucester.org/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
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

  it("400s on a malformed JSON body instead of throwing", async () => {
    const request = new Request("https://levelupgloucester.org/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.2" },
      body: "{not valid json",
    });
    const response = await loginHandler({ request, env: { ...env, ADMIN_TOKEN: "correct-horse" } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON body");
  });
});

describe("POST /api/admin/login — brute-force lockout", () => {
  const LOCKOUT_IP = "203.0.113.10";
  const OTHER_IP = "203.0.113.20";

  it("locks out after 5 failed attempts from the same IP, rejecting even the correct password on the 6th try", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await loginHandler({
        request: loginRequest("wrong", LOCKOUT_IP),
        env: { ...env, ADMIN_TOKEN: "correct-horse" },
      });
      expect(response.status).toBe(401);
    }

    const response = await loginHandler({
      request: loginRequest("correct-horse", LOCKOUT_IP),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("Too many attempts, try again later");
  });

  it("does not lock out a different IP due to another IP's failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await loginHandler({
        request: loginRequest("wrong", LOCKOUT_IP),
        env: { ...env, ADMIN_TOKEN: "correct-horse" },
      });
    }

    const response = await loginHandler({
      request: loginRequest("correct-horse", OTHER_IP),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
  });

  it("does not count failed attempts older than the 15-minute window", async () => {
    const staleIp = "203.0.113.30";
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        "INSERT INTO login_attempts (ip_address, attempted_at) VALUES (?, datetime('now', '-30 minutes'))"
      )
        .bind(staleIp)
        .run();
    }

    const response = await loginHandler({
      request: loginRequest("correct-horse", staleIp),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
  });
});

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
    await insertDonation(env.DB, {
      donorName: "Anonymous",
      donorEmail: "donor@example.com",
      amountCents: 4000,
      designation: "sponsor_a_child",
      stripeSessionId: "cs_admin_test_2",
    });

    const response = await entriesHandler({
      request: authedRequest("https://levelupgloucester.org/api/admin/entries?type=donations&format=csv"),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    const text = await response.text();
    expect(text.split("\n")[0]).toContain("donor_name");
  });

  it("neutralizes CSV formula-injection payloads in exported values", async () => {
    await insertDonation(env.DB, {
      donorName: "=cmd|'/C calc'!A0",
      donorEmail: "donor@example.com",
      amountCents: 4000,
      designation: "sponsor_a_child",
      stripeSessionId: "cs_admin_test_injection_equals",
    });
    await insertDonation(env.DB, {
      donorName: "+1+1",
      donorEmail: "donor2@example.com",
      amountCents: 4000,
      designation: "sponsor_a_child",
      stripeSessionId: "cs_admin_test_injection_plus",
    });
    await insertDonation(env.DB, {
      donorName: "Jamie Walker",
      donorEmail: "donor3@example.com",
      amountCents: 4000,
      designation: "sponsor_a_child",
      stripeSessionId: "cs_admin_test_injection_normal",
    });

    const response = await entriesHandler({
      request: authedRequest("https://levelupgloucester.org/api/admin/entries?type=donations&format=csv"),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    const lines = text.split("\n");
    const headers = lines[0].split(",");
    const donorNameIndex = headers.indexOf("donor_name");

    const unquote = (field) => field.replace(/^"|"$/g, "").replace(/""/g, '"');
    const findDonorName = (sessionId) => {
      const row = lines.find((line) => line.includes(sessionId));
      const fields = row.split(",");
      return unquote(fields[donorNameIndex]);
    };

    expect(findDonorName("cs_admin_test_injection_equals")).toBe("'=cmd|'/C calc'!A0");
    expect(findDonorName("cs_admin_test_injection_plus")).toBe("'+1+1");
    // Normal values must pass through byte-for-byte unchanged (no false positives).
    expect(findDonorName("cs_admin_test_injection_normal")).toBe("Jamie Walker");
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

  it("creates a basket with an optional ARV", async () => {
    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({
          kind: "basket",
          name: "Wingspan Bundle",
          description: "Wingspan + European expansion",
          image_path: "images/baskets/wingspan.jpg",
          arv_cents: 15000,
        }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
  });

  it("rejects a negative ARV", async () => {
    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({
          kind: "basket",
          name: "Bad Bundle",
          description: "invalid arv",
          image_path: "images/baskets/bad.jpg",
          arv_cents: -100,
        }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(400);
  });

  it("updates a basket's ARV after creation", async () => {
    const { id } = await insertBasket(env.DB, {
      name: "Terraforming Mars Bundle",
      description: "Terraforming Mars + expansion",
      image_path: "images/baskets/tm.jpg",
    });

    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({ kind: "basket_arv", id, arv_cents: 8500 }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
  });

  it("updates a workshop day's image after creation", async () => {
    const { id } = await insertWorkshopDay(env.DB, {
      title: "April Vacation Workshop",
      eventDate: "2027-04-21",
      location: "TBD",
      priceFullCents: 6500,
      priceHalfCents: 4000,
      capacity: 20,
    });

    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({ kind: "workshop_day_image", id, image_path: "images/workshops/april.jpg" }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
  });

  it("400s on a malformed JSON body instead of throwing", async () => {
    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: "{not valid json",
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("creates a workshop day with valid numeric fields", async () => {
    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({
          kind: "workshop_day",
          title: "May Vacation Workshop",
          eventDate: "2027-05-01",
          location: "TBD",
          priceFullCents: 6500,
          priceHalfCents: 4000,
          capacity: 12,
        }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBeDefined();
  });

  it("400s when capacity is not an integer, and does not insert a row", async () => {
    const { results: before } = await env.DB.prepare("SELECT COUNT(*) AS count FROM workshop_days").all();

    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({
          kind: "workshop_day",
          title: "Bad Capacity Workshop",
          eventDate: "2027-05-02",
          location: "TBD",
          priceFullCents: 6500,
          priceHalfCents: 4000,
          capacity: "twenty",
        }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/capacity/);

    const { results: after } = await env.DB.prepare("SELECT COUNT(*) AS count FROM workshop_days").all();
    expect(after[0].count).toBe(before[0].count);
  });

  it("400s when priceFullCents is a non-integer number, and does not insert a row", async () => {
    const response = await manageHandler({
      request: new Request("https://levelupgloucester.org/api/admin/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "levelup_admin=correct-horse" },
        body: JSON.stringify({
          kind: "workshop_day",
          title: "Bad Price Workshop",
          eventDate: "2027-05-03",
          location: "TBD",
          priceFullCents: 65.5,
          priceHalfCents: 4000,
          capacity: 10,
        }),
      }),
      env: { ...env, ADMIN_TOKEN: "correct-horse" },
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/priceFullCents/);
  });
});
