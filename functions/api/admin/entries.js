// functions/api/admin/entries.js
import { isAuthorized } from "../../../lib/auth.js";
import { listRaffleEntries, listRegistrations, listDonations } from "../../../lib/db.js";

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export async function onRequestGet({ request, env }) {
  if (!isAuthorized(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const format = url.searchParams.get("format") ?? "json";

  let rows;
  if (type === "raffle") {
    rows = await listRaffleEntries(env.DB);
  } else if (type === "registrations") {
    rows = await listRegistrations(env.DB);
  } else if (type === "donations") {
    rows = await listDonations(env.DB);
  } else {
    return Response.json({ error: "type must be raffle, registrations, or donations" }, { status: 400 });
  }

  if (format === "csv") {
    return new Response(toCsv(rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  return Response.json(rows);
}
