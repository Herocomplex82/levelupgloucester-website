// Run with: node --test scripts/sweepstakes/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  bonusEntries,
  allocateBonus,
  matchBasket,
  tallyPurchases,
  buildBasketEntries,
  drawWinners,
} from "./core.js";
import { BASKETS } from "./baskets.js";

test("parseCsv handles quoted fields, embedded commas and CRLF", () => {
  const rows = parseCsv('Name,Item\r\n"Smith, Jo","Wooden ""Classics"""\r\n');
  assert.deepEqual(rows, [{ Name: "Smith, Jo", Item: 'Wooden "Classics"' }]);
});

test("bonusEntries follows the published tiers", () => {
  assert.equal(bonusEntries(4), 0);
  assert.equal(bonusEntries(5), 1); // $5 -> 6 entries
  assert.equal(bonusEntries(19), 3);
  assert.equal(bonusEntries(20), 5); // $20 -> 25 entries
  assert.equal(bonusEntries(49), 12);
  assert.equal(bonusEntries(50), 25); // $50 -> 75 entries
  assert.equal(bonusEntries(100), 50);
});

test("allocateBonus splits proportionally and never loses an entry", () => {
  const result = allocateBonus({ a: 10, b: 5, c: 5 }, 5);
  assert.equal(Object.values(result).reduce((s, n) => s + n, 0), 5);
  assert.ok(result.a >= 2);
  assert.deepEqual(allocateBonus({ a: 3 }, 0), { a: 0 });
});

test("matchBasket maps Zeffy item names to basket ids, case-insensitively", () => {
  assert.equal(matchBasket("Strategy Showcase", BASKETS), "strategy-showcase");
  assert.equal(matchBasket("  pokémon trainer a ", BASKETS), "pokemon-a");
  assert.equal(matchBasket("Basket 7 - Brain Busters & Stocking Stuffers", BASKETS), "brain-busters");
  assert.equal(matchBasket("Something else", BASKETS), null);
});

test("tallyPurchases groups by email, sums quantities, and reports unknown items", () => {
  const rows = [
    { Email: "A@x.com", "First Name": "Ann", "Last Name": "Lee", "Ticket type": "Little Gamers", Quantity: "3" },
    { Email: "a@x.com", "First Name": "Ann", "Last Name": "Lee", "Ticket type": "UNO-verse", Quantity: "2" },
    { Email: "b@x.com", "First Name": "Bo", "Last Name": "Ray", "Ticket type": "Mystery", Quantity: "1" },
  ];
  const cols = { email: "Email", first: "First Name", last: "Last Name", item: "Ticket type", qty: "Quantity" };
  const { buyers, problems } = tallyPurchases(rows, cols, BASKETS);
  const ann = buyers.get("a@x.com");
  assert.equal(ann.name, "Ann Lee");
  assert.deepEqual(ann.paid, { "little-gamers": 3, "uno-verse": 2 });
  assert.equal(problems.length, 1);
});

test("tallyPurchases counts one entry per row when there is no quantity column", () => {
  const rows = [
    { Email: "c@x.com", "Ticket type": "Little Gamers" },
    { Email: "c@x.com", "Ticket type": "Little Gamers" },
  ];
  const { buyers } = tallyPurchases(rows, { email: "Email", item: "Ticket type" }, BASKETS);
  assert.deepEqual(buyers.get("c@x.com").paid, { "little-gamers": 2 });
});

test("buildBasketEntries applies bonuses and gives each mail-in 1 entry per basket", () => {
  const buyers = new Map([
    ["a@x.com", { name: "Ann", email: "a@x.com", paid: { "little-gamers": 20 } }], // +5 bonus = 25
    ["b@x.com", { name: "Bo", email: "b@x.com", paid: { "little-gamers": 2 } }], // no bonus = 2
  ]);
  const mailIns = [
    { name: "Cy", email: "c@x.com", basketId: "little-gamers" },
    { name: "Cy", email: "c@x.com", basketId: "little-gamers" }, // duplicate ignored
    { name: "Di", email: "d@x.com", basketId: "uno-verse" }, // basket with no paid entrants
  ];
  const entries = buildBasketEntries(buyers, mailIns);
  const little = entries.get("little-gamers");
  assert.deepEqual(little.map((e) => [e.name, e.entries, e.source]), [
    ["Ann", 25, "paid"],
    ["Bo", 2, "paid"],
    ["Cy", 1, "mail-in"],
  ]);
  assert.equal(entries.get("uno-verse")[0].entries, 1);
});

test("drawWinners returns distinct people, weighted by entries", () => {
  const entrants = [
    { name: "Ann", email: "a", entries: 1 },
    { name: "Bo", email: "b", entries: 1 },
    { name: "Cy", email: "c", entries: 1 },
  ];
  const winners = drawWinners(entrants, 3, (max) => 0);
  assert.deepEqual(winners.map((w) => w.name), ["Ann", "Bo", "Cy"]);

  const lopsided = [
    { name: "Ann", email: "a", entries: 1 },
    { name: "Bo", email: "b", entries: 99 },
  ];
  assert.equal(drawWinners(lopsided, 1, () => 50)[0].name, "Bo");
  assert.deepEqual(drawWinners([], 2, () => 0), []);
});
