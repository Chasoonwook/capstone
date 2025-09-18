import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "sp_access_token";
const ACCESS_EXP_COOKIE = "sp_access_expires_at";
const REFRESH_COOKIE = "sp_refresh_token";

type RefreshResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};

export async function GET(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value ?? null;
  const expAt = Number(req.cookies.get(ACCESS_EXP_COOKIE)?.value ?? 0);
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value ?? null;

  // 1) 아직 유효한 access_token이 있으면 그대로 반환
  if (access && Date.now() + 60_000 < expAt) {
    const ttl = Math.max(30, Math.floor((expAt - Date.now()) / 1000));
    return NextResponse.json({ access_token: access, expires_in: ttl });
  }

  // 2) refresh_token으로 갱신
  if (!refresh) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    cache: "no-store",
  });

  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: "refresh_failed", detail: t }, { status: 401 });
  }

  const js: RefreshResponse = await r.json();
  const res = NextResponse.json({ access_token: js.access_token, expires_in: js.expires_in });

  const newExp = Date.now() + Math.max(30, js.expires_in - 60) * 1000;
  res.cookies.set(ACCESS_COOKIE, js.access_token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: js.expires_in });
  res.cookies.set(ACCESS_EXP_COOKIE, String(newExp), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: js.expires_in });
  if (js.refresh_token) {
    res.cookies.set(REFRESH_COOKIE, js.refresh_token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
}
