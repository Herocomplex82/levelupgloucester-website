#!/usr/bin/env node
// Holiday Basket Sweepstakes drawing.
//
// Usage:
//   node scripts/sweepstakes/draw.js --sales zeffy-export.csv [--mailin mailin.csv] [--out results] [--dry-run]
//
//   --sales    Zeffy sales/ticket export (CSV). Column headers are auto-detected;
//              override with --email-col, --item-col, --qty-col, --name-col,
//              --first-col, --last-col if Zeffy's headers differ.
//   --mailin   Optional CSV of free mail-in entries with columns: Name, Email, Basket
//   --out      Output folder (default: sweepstakes-results)
//   --dry-run  Build and report entry totals without drawing winners.
//
// Writes one entries-<basket>.csv per basket plus winners.csv (winner + 2 alternates).
import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASKETS } from "./baskets.js";
import { buildBasketEntries, drawWinners, matchBasket, parseCsv, tallyPurchases } from "./core.js";

const ALTERNATES = 2;
const CANDIDATES = {
  email: ["Email", "Email address", "Buyer email", "Payer email", "Purchaser email"],
  item: ["Ticket type", "Ticket", "Rate", "Item", "Item name", "Product"],
  qty: ["Quantity", "Qty", "Number of tickets"],
  name: ["Name", "Full name", "Buyer name", "Payer name"],
  first: ["First name", "First Name", "Buyer first name"],
  last: ["Last name", "Last Name", "Buyer last name"],
};

function parseArgs(argv) {
  const args = { out: "sweepstakes-results" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag.startsWith("--")) args[flag.slice(2)] = argv[++i];
  }
  return args;
}

function detectColumns(headers, args) {
  const lower = new Map(headers.map((h) => [h.toLowerCase(), h]));
  const find = (key) => args[`${key}-col`] ?? CANDIDATES[key].map((c) => lower.get(c.toLowerCase())).find(Boolean);
  const cols = Object.fromEntries(Object.keys(CANDIDATES).map((k) => [k, find(k)]));
  if (!cols.email || !cols.item) {
    throw new Error(
      `Could not find the email and/or item columns.\nHeaders in file: ${headers.join(" | ")}\n` +
        "Pass them explicitly, e.g. --email-col \"Email\" --item-col \"Ticket type\"",
    );
  }
  return cols;
}

function csvCell(value) {
  const text = String(value ?? "");
  // Neutralize spreadsheet formula injection from public-submitted names.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function writeCsv(file, header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  writeFileSync(file, `${lines.join("\n")}\n`);
}

function loadMailIns(file) {
  if (!file) return { mailIns: [], problems: [] };
  const problems = [];
  const mailIns = parseCsv(readFileSync(file, "utf8")).flatMap((row, i) => {
    const basketId = matchBasket(row.Basket ?? "", BASKETS);
    if (!basketId || !row.Name) {
      problems.push(`Mail-in row ${i + 2}: needs Name and a known Basket (got "${row.Basket}")`);
      return [];
    }
    return [{ name: row.Name, email: row.Email ?? "", basketId }];
  });
  return { mailIns, problems };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sales) {
    console.error("Usage: node scripts/sweepstakes/draw.js --sales zeffy-export.csv [--mailin mailin.csv] [--out dir] [--dry-run]");
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(args.sales, "utf8"));
  if (rows.length === 0) throw new Error(`No rows found in ${args.sales}`);
  const cols = detectColumns(Object.keys(rows[0]), args);
  console.log("Columns used:", cols);

  const { buyers, problems } = tallyPurchases(rows, cols, BASKETS);
  const mail = loadMailIns(args.mailin);
  const allProblems = [...problems, ...mail.problems];
  if (allProblems.length > 0) {
    console.error(`\n${allProblems.length} row(s) need attention before drawing:\n  ${allProblems.join("\n  ")}`);
    process.exit(1);
  }

  const entries = buildBasketEntries(buyers, mail.mailIns);
  mkdirSync(args.out, { recursive: true });
  const winnerRows = [];

  for (const basket of BASKETS) {
    const list = entries.get(basket.id) ?? [];
    const total = list.reduce((s, e) => s + e.entries, 0);
    console.log(`${basket.name.padEnd(36)} ${String(list.length).padStart(4)} entrants  ${String(total).padStart(5)} entries`);
    writeCsv(
      path.join(args.out, `entries-${basket.id}.csv`),
      ["Name", "Email", "Entries", "Source"],
      list.map((e) => [e.name, e.email, e.entries, e.source]),
    );
    if (args.dryRun) continue;
    drawWinners(list, 1 + ALTERNATES, randomInt).forEach((w, i) => {
      winnerRows.push([basket.name, i === 0 ? "Winner" : `Alternate ${i}`, w.name, w.email, w.entries, total]);
    });
  }

  if (!args.dryRun) {
    writeCsv(
      path.join(args.out, "winners.csv"),
      ["Basket", "Place", "Name", "Email", "Their entries", "Basket total entries"],
      winnerRows,
    );
    console.log(`\nDrawn at ${new Date().toISOString()}. Results in ${args.out}/winners.csv`);
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
