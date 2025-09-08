// src/lib/spotify.ts
import { cookies } from "next/headers";

/** ---------- 쿠키 헬퍼 (Next.js 14.2+/15) ---------- */
/** cookies()가 비동기이므로 반드시 await */
export async function readCookie(name: string): Promise<string | null> {
  const store = await cookies();
  return store.get(name)?.value ?? null;
}

export const VERIFIER_COOKIE = "sp_verifier";

type SetCookieOptions = {
  /** 초 단위 maxAge */
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  expires?: Date;
  domain?: string;
};

export async function writeCookie(
  name: string,
  value: string,
  opts: SetCookieOptions = {},
): Promise<void> {
  const store = await cookies();
  const {
    maxAge,
    path = "/",
    httpOnly = true,
    secure = process.env.NODE_ENV === "production",
    sameSite = "lax",
    expires,
    domain,
  } = opts;

  store.set({
    name,
    value,
    path,
    httpOnly,
    secure,
    sameSite,
    ...(typeof maxAge === "number" ? { maxAge } : {}),
    ...(expires ? { expires } : {}),
    ...(domain ? { domain } : {}),
  });
}

export async function setTokenCookies(access: string, refresh: string, expiresInSec?: number) {
  await setAccessCookie(access, expiresInSec);
  if (refresh) {
    await setRefreshCookie(refresh);
  }
}

export async function exchangeCodeForToken(code: string, verifier: string): Promise<ExchangeResponse> {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri!,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status}`);

  return (await res.json()) as ExchangeResponse;
}

export type ExchangeResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  expires_in: number;
};

export async function deleteCookie(name: string): Promise<void> {
  const store = await cookies();
  // expires 과거로 설정하여 삭제
  store.set({
    name,
    value: "",
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
  });
}

/** ---------- 도메인 로직 헬퍼 ---------- */
const ACCESS_KEY = "sp_access";
const REFRESH_KEY = "sp_refresh";

/** 액세스/리프레시 토큰 읽기 */
export async function getAccessCookie(): Promise<string | null> {
  return readCookie(ACCESS_KEY);
}
export async function getRefreshCookie(): Promise<string | null> {
  return readCookie(REFRESH_KEY);
}

/** 액세스/리프레시 토큰 쓰기 */
export async function setAccessCookie(
  token: string,
  expiresInSec?: number, // Spotify가 주는 expires_in(sec)
) {
  // 만료 60초 전에 재갱신 여유
  const maxAge = typeof expiresInSec === "number" ? Math.max(0, expiresInSec - 60) : undefined;
  await writeCookie(ACCESS_KEY, token, { maxAge });
}
export async function setRefreshCookie(token: string) {
  // 리프레시 토큰은 길게(예: 30일) — 필요에 맞게 조정
  await writeCookie(REFRESH_KEY, token, { maxAge: 60 * 60 * 24 * 30 });
}
export async function clearSpotifyCookies() {
  await deleteCookie(ACCESS_KEY);
  await deleteCookie(REFRESH_KEY);
}

/** ---------- Spotify 토큰 갱신 API 호출 ---------- */
type RefreshResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

export async function refreshSpotifyToken(refreshToken: string): Promise<RefreshResponse> {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Spotify client env vars are missing.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body,
    // Edge에서도 동작하도록 캐시/모드 명시는 생략
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to refresh token: ${res.status} ${text}`);
  }
  return (await res.json()) as RefreshResponse;
}
