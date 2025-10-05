// src/app/api/spotify/login/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SameSite = "lax" | "strict" | "none";
type CookieOpts = { httpOnly?: boolean; secure?: boolean; path?: string; sameSite?: SameSite; maxAge?: number };

function parseCookieHeader(h: string | null): Record<string, string> {
  if (!h) return {};
  return Object.fromEntries(
    h.split(";").map(v => v.trim()).filter(Boolean).map(v => {
      const i = v.indexOf("="); 
      return i === -1 ? [v, ""] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
    })
  );
}
function serializeCookie(name: string, value: string, opts: CookieOpts = {}): string {
  const segs = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) segs.push(`Max-Age=${opts.maxAge}`);
  segs.push(`Path=${opts.path ?? "/"}`);
  if (opts.httpOnly) segs.push("HttpOnly");
  if (opts.secure) segs.push("Secure");
  if (opts.sameSite) segs.push(`SameSite=${opts.sameSite}`);
  return segs.join("; ");
}

const isProd = process.env.NODE_ENV === "production";

type RefreshResp = { access_token: string; token_type: "Bearer"; expires_in: number; scope?: string; refresh_token?: string };

export async function GET(req: Request) {
  const jar = parseCookieHeader(req.headers.get("cookie"));
  const at = jar["sp_at"];
  if (at) return NextResponse.json({ access_token: at });

  const rt = jar["sp_rt"];
  if (!rt) return new NextResponse(null, { status: 204 });

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rt,
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
  });
  if (process.env.SPOTIFY_CLIENT_SECRET) {
    params.set("client_secret", process.env.SPOTIFY_CLIENT_SECRET);
  }

  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });

  if (!r.ok) {
    const resErr = NextResponse.json({ error: "refresh_failed" }, { status: 500 });
    resErr.headers.append("Set-Cookie", serializeCookie("sp_rt", "", { path: "/", maxAge: 0 }));
    resErr.headers.append("Set-Cookie", serializeCookie("sp_at", "", { path: "/", maxAge: 0 }));
    return resErr;
  }

  const js = (await r.json()) as RefreshResp;
  const res = NextResponse.json({ access_token: js.access_token });
  res.headers.append(
    "Set-Cookie",
    serializeCookie("sp_at", js.access_token, {
      httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: Math.max(60, (js.expires_in ?? 3600) - 60),
    })
  );
  if (js.refresh_token) {
    res.headers.append(
      "Set-Cookie",
      serializeCookie("sp_rt", js.refresh_token, {
        httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
      })
    );
  }
  return res;
}
