// src/app/api/spotify/callback/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// --- 쿠키 직렬화 헬퍼 (수정 없음) ---
type SameSite = "lax" | "strict" | "none";
type CookieOpts = { httpOnly?: boolean; secure?: boolean; path?: string; sameSite?: SameSite; maxAge?: number };
function serializeCookie(name: string, value: string, opts: CookieOpts = {}): string {
    const segs = [`${name}=${encodeURIComponent(value)}`];
    if (opts.maxAge !== undefined) segs.push(`Max-Age=${opts.maxAge}`);
    segs.push(`Path=${opts.path ?? "/"}`);
    if (opts.httpOnly) segs.push("HttpOnly");
    if (opts.secure) segs.push("Secure");
    if (opts.sameSite) segs.push(`SameSite=${opts.sameSite}`);
    return segs.join("; ");
}
function parseCookieHeader(h: string | null): Record<string, string> {
  if (!h) return {};
  return Object.fromEntries(
    h.split(";").map(v => v.trim()).filter(Boolean).map(v => {
      const i = v.indexOf("=");
      return i === -1 ? [v, ""] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
    })
  );
}
// --- 헬퍼 끝 ---


const isProd = process.env.NODE_ENV === "production";
type PkceCookie = { state: string; verifier: string; redirectUri: string };
type TokenResp = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token?: string; scope: string };

function parsePkce(raw: string | undefined): PkceCookie | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.state !== "string" || typeof o.verifier !== "string" || typeof o.redirectUri !== "string") return null;
    return { state: o.state, verifier: o.verifier, redirectUri: o.redirectUri } as PkceCookie;
  } catch { return null; }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = parseCookieHeader(req.headers.get("cookie"));
  const pk = parsePkce(jar["sp_pkce"]);
  if (!code || !state || !pk || state !== pk.state) {
    return NextResponse.json({ ok: false, reason: "pkce_mismatch" }, { status: 400 });
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pk.redirectUri,
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    code_verifier: pk.verifier,
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
  if (!r.ok) return NextResponse.json({ ok: false, reason: "token_exchange_failed" }, { status: 500 });

  const t = (await r.json()) as TokenResp;

  // 성공 시 메인 페이지로 리디렉션
  const res = NextResponse.redirect(new URL("/", req.url));

  // ✅ [수정] 쿠키 이름을 'sp_access_token'과 'sp_refresh_token'으로 통일합니다.
  res.headers.append(
    "Set-Cookie",
    serializeCookie("sp_access_token", t.access_token, {
      httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: Math.max(60, (t.expires_in ?? 3600) - 60),
    })
  );
  if (t.refresh_token) {
    res.headers.append(
      "Set-Cookie",
      serializeCookie("sp_refresh_token", t.refresh_token, {
        httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
      })
    );
  }
  
  // PKCE 쿠키는 사용 후 삭제
  res.headers.append("Set-Cookie", serializeCookie("sp_pkce", "", { path: "/", maxAge: 0 }));
  
  return res;
}