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
