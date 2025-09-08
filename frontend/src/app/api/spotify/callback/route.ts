import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err  = url.searchParams.get("error");
  if (err) return NextResponse.redirect(new URL("/?spotify=error", url.origin));
  if (!code) return NextResponse.redirect(new URL("/?spotify=missing_code", url.origin));

  const cookie = (req.headers.get("cookie") ?? "");
  const m = /(?:^|;\s*)sp_verifier=([^;]+)/.exec(cookie);
  const verifier = m?.[1];
  if (!verifier) return NextResponse.redirect(new URL("/?spotify=missing_verifier", url.origin));

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    code_verifier: verifier,
  });

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenRes.ok) return NextResponse.redirect(new URL("/?spotify=token_fail", url.origin));

  const js = await tokenRes.json() as any;
  const res = NextResponse.redirect(new URL("/?spotify=ok", url.origin));

  // access / refresh 저장
  const maxAge = Math.max(1, Math.floor((js.expires_in ?? 3600) * 0.9));
  res.cookies.set("sp_access",  js.access_token,  { httpOnly:true, sameSite:"lax", path:"/", maxAge });
  if (js.refresh_token) {
    res.cookies.set("sp_refresh", js.refresh_token, { httpOnly:true, sameSite:"lax", path:"/" });
  }
  res.cookies.set("sp_verifier", "", { httpOnly:true, sameSite:"lax", path:"/", maxAge:0 });
  return res;
}
