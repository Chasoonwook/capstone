export const runtime = "nodejs";

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const access  = /(?:^|;\s*)sp_access=([^;]+)/.exec(cookie)?.[1] ?? null;
  const refresh = /(?:^|;\s*)sp_refresh=([^;]+)/.exec(cookie)?.[1] ?? null;

  // access 있으면 바로 반환
  if (access) {
    return new Response(JSON.stringify({ access_token: access }), {
      headers: { "content-type": "application/json" },
    });
  }

  // access 없고 refresh 도 없으면 204 (콘솔 빨간줄 피하기)
  if (!refresh) return new Response(null, { status: 204 });

  // refresh 로 갱신
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
  });

  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) return new Response(null, { status: 204 });

  const js = (await r.json()) as any;
  const res = new Response(JSON.stringify({ access_token: js.access_token }), {
    headers: { "content-type": "application/json" },
  });
  const maxAge = Math.max(1, Math.floor((js.expires_in ?? 3600) * 0.9));
  res.headers.append(
    "Set-Cookie",
    `sp_access=${js.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
  return res;
}
