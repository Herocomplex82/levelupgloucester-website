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
