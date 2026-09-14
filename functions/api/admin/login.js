import { countRecentFailedLoginAttempts, recordFailedLoginAttempt } from "../../../lib/db.js";

const LOGIN_ATTEMPT_WINDOW_MINUTES = 15;
const MAX_LOGIN_ATTEMPTS = 5;

export async function onRequestPost({ request, env }) {
  const { password } = await request.json();
  const ipAddress = request.headers.get("CF-Connecting-IP") ?? "unknown";

  const recentFailures = await countRecentFailedLoginAttempts(
    env.DB,
    ipAddress,
    LOGIN_ATTEMPT_WINDOW_MINUTES
  );
  if (recentFailures >= MAX_LOGIN_ATTEMPTS) {
    return Response.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  if (!env.ADMIN_TOKEN || password !== env.ADMIN_TOKEN) {
    await recordFailedLoginAttempt(env.DB, ipAddress);
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `levelup_admin=${env.ADMIN_TOKEN}; HttpOnly; Secure; SameSite=Strict; Max-Age=28800; Path=/`,
    },
  });
}
