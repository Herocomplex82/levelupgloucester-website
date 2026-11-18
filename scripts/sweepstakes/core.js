// Pure logic for the holiday basket sweepstakes drawing. No file or network I/O
// here, so it can be tested directly; draw.js handles reading and writing files.

// Bonus tiers published on raffle.html and in the Official Rules.
// Every $1 = 1 entry; bonus is a percentage of the buyer's TOTAL paid entries.
const BONUS_TIERS = [
  { min: 50, rate: 0.5 },
  { min: 20, rate: 0.25 },
  { min: 5, rate: 0.2 },
];

export function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [header, ...body] = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, idx) => [h.trim(), (r[idx] ?? "").trim()])));
}

export function bonusEntries(paidTotal) {
  const tier = BONUS_TIERS.find((t) => paidTotal >= t.min);
  return tier ? Math.floor(paidTotal * tier.rate) : 0;
}

// Largest-remainder split of `bonus` across baskets, proportional to paid entries.
export function allocateBonus(paidByBasket, bonus) {
  const ids = Object.keys(paidByBasket);
  const total = ids.reduce((sum, id) => sum + paidByBasket[id], 0);
  if (bonus === 0 || total === 0) return Object.fromEntries(ids.map((id) => [id, 0]));

  const shares = ids.map((id) => {
    const exact = (paidByBasket[id] / total) * bonus;
    return { id, whole: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let leftover = bonus - shares.reduce((sum, s) => sum + s.whole, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder);
  const extra = new Set(byRemainder.slice(0, leftover).map((s) => s.id));
  return Object.fromEntries(shares.map((s) => [s.id, s.whole + (extra.has(s.id) ? 1 : 0)]));
}

function normalize(text) {
  return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function matchBasket(itemName, baskets) {
  const item = normalize(itemName);
  const candidates = baskets.flatMap((b) => b.keys.map((key) => ({ id: b.id, key })));
  candidates.sort((a, b) => b.key.length - a.key.length);
  const hit = candidates.find((c) => item.includes(c.key));
  return hit ? hit.id : null;
}

// cols: { email, item, qty?, name?, first?, last? } -> column headers in the export.
export function tallyPurchases(rows, cols, baskets) {
  const buyers = new Map();
  const problems = [];

  rows.forEach((row, index) => {
    const line = index + 2; // +1 for header, +1 for 1-based
    const email = normalize(row[cols.email] ?? "");
    const basketId = matchBasket(row[cols.item] ?? "", baskets);
    const qty = cols.qty ? Number.parseInt(row[cols.qty], 10) : 1;

    if (!email) return problems.push(`Row ${line}: missing email`);
    if (!basketId) return problems.push(`Row ${line}: unknown basket "${row[cols.item]}"`);
    if (!Number.isInteger(qty) || qty < 1) return problems.push(`Row ${line}: bad quantity "${row[cols.qty]}"`);

    const name = cols.name
      ? row[cols.name]
      : [row[cols.first], row[cols.last]].filter(Boolean).join(" ");
    const existing = buyers.get(email) ?? { name: name || email, email, paid: {} };
    const paid = { ...existing.paid, [basketId]: (existing.paid[basketId] ?? 0) + qty };
    buyers.set(email, { ...existing, paid });
  });

  return { buyers, problems };
}

// Returns Map<basketId, [{ name, email, entries, source }]>
export function buildBasketEntries(buyers, mailIns) {
  const entries = new Map();
  const add = (basketId, entrant) => entries.set(basketId, [...(entries.get(basketId) ?? []), entrant]);

  for (const buyer of buyers.values()) {
    const paidTotal = Object.values(buyer.paid).reduce((sum, n) => sum + n, 0);
    const bonus = allocateBonus(buyer.paid, bonusEntries(paidTotal));
    for (const [basketId, count] of Object.entries(buyer.paid)) {
      add(basketId, { name: buyer.name, email: buyer.email, entries: count + bonus[basketId], source: "paid" });
    }
  }

  // Official Rules: one free mail-in entry per person per basket, worth 1 entry
  // (the same as a $1 paid entry).
  const seen = new Set();
  for (const m of mailIns) {
    const key = `${normalize(m.email || m.name)}|${m.basketId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add(m.basketId, { name: m.name, email: m.email, entries: 1, source: "mail-in" });
  }

  return entries;
}

// Draws `count` distinct winners (1st = winner, rest = alternates for re-draws).
// randomInt(max) must return an integer in [0, max).
export function drawWinners(entrants, count, randomInt) {
  let pool = [...entrants];
  const winners = [];
  while (winners.length < count && pool.length > 0) {
    const total = pool.reduce((sum, e) => sum + e.entries, 0);
    let ticket = randomInt(total);
    const index = pool.findIndex((e) => (ticket -= e.entries) < 0);
    winners.push(pool[index]);
    pool = pool.filter((_, i) => i !== index);
  }
  return winners;
}
