export function isAuthorized(request, env) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const idx = c.indexOf("=");
        return [c.slice(0, idx), c.slice(idx + 1)];
      })
  );
  return Boolean(env.ADMIN_TOKEN) && cookies.levelup_admin === env.ADMIN_TOKEN;
}
