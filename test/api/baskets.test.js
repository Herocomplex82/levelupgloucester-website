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
