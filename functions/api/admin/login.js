export async function onRequestPost({ request, env }) {
  const { password } = await request.json();

  if (!env.ADMIN_TOKEN || password !== env.ADMIN_TOKEN) {
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
