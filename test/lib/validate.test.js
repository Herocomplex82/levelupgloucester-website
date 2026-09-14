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
