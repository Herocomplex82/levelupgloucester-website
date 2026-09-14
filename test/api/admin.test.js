import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { onRequestPost as loginHandler } from "../../functions/api/admin/login.js";
import { onRequestGet as entriesHandler } from "../../functions/api/admin/entries.js";
import { onRequestPost as manageHandler } from "../../functions/api/admin/manage.js";
import { insertDonation } from "../../lib/db.js";

function authedRequest(url) {
  return new Request(url, { headers: { Cookie: "levelup_admin=correct-horse" } });
}

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
