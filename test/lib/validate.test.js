import { describe, expect, it } from "vitest";
import { isValidEmail, redactSecrets, requireFields } from "../../lib/validate.js";

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

describe("redactSecrets", () => {
  it("redacts an embedded sk_live_ secret key", () => {
    const message = "Stripe rejected key sk_live_51ABCdef1234567890xyz as invalid";
    expect(redactSecrets(message)).toBe("Stripe rejected key [REDACTED] as invalid");
  });

  it("redacts an embedded sk_test_ secret key", () => {
    const message = "auth failed using sk_test_51ABCdef1234567890xyz during setup";
    expect(redactSecrets(message)).toBe("auth failed using [REDACTED] during setup");
  });

  it("redacts an embedded whsec_ webhook signing secret", () => {
    const message = "signature check failed for whsec_abc123XYZ_secretvalue here";
    expect(redactSecrets(message)).toBe("signature check failed for [REDACTED] here");
  });

  it("redacts multiple secrets in the same message", () => {
    const message = "keys sk_live_aaa111 and whsec_bbb222 both leaked";
    expect(redactSecrets(message)).toBe("keys [REDACTED] and [REDACTED] both leaked");
  });

  it("leaves an ordinary error message with no secret pattern completely unchanged", () => {
    const message = "Workshop day 42 is full, please try another date.";
    expect(redactSecrets(message)).toBe(message);
  });

  it("passes through non-string values unchanged", () => {
    expect(redactSecrets(undefined)).toBe(undefined);
    expect(redactSecrets(null)).toBe(null);
  });
});
