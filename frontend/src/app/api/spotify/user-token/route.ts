// src/app/api/spotify/user-token/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ACCESS_COOKIE = "sp_access_token";
const ACCESS_EXP_COOKIE = "sp_access_expires_at"; // 만료 시간 쿠키 (선택 사항)
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
  //    (만료 60초 전까지 유효하다고 간주)
  if (access && Date.now() + 60_000 < expAt) {
    const ttl = Math.max(30, Math.floor((expAt - Date.now()) / 1000));
    return NextResponse.json({ access_token: access, expires_in: ttl });
  }

  // 2) refresh_token으로 갱신 시도
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

  // 3) 갱신된 토큰을 다시 쿠키에 저장
  const newExp = Date.now() + Math.max(30, js.expires_in - 60) * 1000;
  res.cookies.set(ACCESS_COOKIE, js.access_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: js.expires_in });
  res.cookies.set(ACCESS_EXP_COOKIE, String(newExp), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: js.expires_in });
  
  // 스포티파이가 새 refresh_token을 주면 그것도 갱신
  if (js.refresh_token) {
    res.cookies.set(REFRESH_COOKIE, js.refresh_token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  
  return res;
}