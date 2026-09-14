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
