// src/lib/spotify.ts
import "server-only";
import crypto from "crypto";

export const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!;
export const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
export const REDIRECT_URI = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI!;
export const SCOPES =
  process.env.NEXT_PUBLIC_SPOTIFY_SCOPES ??
  "user-read-email user-read-private streaming user-read-playback-state user-modify-playback-state";

// 쿠키 이름 상수만 노출 (설정/삭제는 각 Route에서 처리)
export const ACCESS_COOKIE = "sp_access";
export const REFRESH_COOKIE = "sp_refresh";
export const VERIFIER_COOKIE = "sp_verifier";

// --- PKCE ---
export function generateCodeVerifier(len = 64) {
  const possible = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  let text = "";
  for (let i = 0; i < len; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
export function generateCodeChallenge(verifier: string) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// --- 토큰 교환/갱신 ---
async function tokenRequest(body: Record<string, string>) {
  const data = new URLSearchParams(body);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64"),
    },
    body: data.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Spotify token error: ${res.status} ${t}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export function buildAuthorizeURL(codeChallenge: string) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    scope: SCOPES,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export function exchangeCodeForTokens(code: string, codeVerifier: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}
