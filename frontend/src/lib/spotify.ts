// src/lib/spotify.ts
// 이 파일은 "서버 전용 helpers(쿠키 읽기/쓰기)"와
// "클라이언트 전용 helpers(/api/spotify/me 상태 조회)"를 함께 담습니다.
// - 서버 전용: next/headers 의 cookies() 사용 (클라이언트에서 호출 금지)
// - 클라이언트 전용: window/fetch 사용 (서버에서 호출 금지)

import { cookies } from "next/headers"

/* ------------------------------------------------------------------ */
/* 서버 전용: 쿠키 헬퍼 (Next.js 14.2+/15)                            */
/* ------------------------------------------------------------------ */
/** cookies()가 비동기이므로 반드시 await */
export async function readCookie(name: string): Promise<string | null> {
  const store = await cookies()
  return store.get(name)?.value ?? null
}

export const VERIFIER_COOKIE = "sp_verifier"

type SetCookieOptions = {
  /** 초 단위 maxAge */
  maxAge?: number
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: "lax" | "strict" | "none"
  expires?: Date
  domain?: string
}

export async function writeCookie(
  name: string,
  value: string,
  opts: SetCookieOptions = {},
): Promise<void> {
  const store = await cookies()
  const {
    maxAge,
    path = "/",
    httpOnly = true,
    secure = process.env.NODE_ENV === "production",
    sameSite = "lax",
    expires,
    domain,
  } = opts

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
  })
}

export async function setTokenCookies(access: string, refresh: string, expiresInSec?: number) {
  await setAccessCookie(access, expiresInSec)
  if (refresh) {
    await setRefreshCookie(refresh)
  }
}

export async function exchangeCodeForToken(code: string, verifier: string): Promise<ExchangeResponse> {
  const redirectUri = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri!,
    code_verifier: verifier,
  })

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })

  if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status}`)

  return (await res.json()) as ExchangeResponse
}

export type ExchangeResponse = {
  access_token: string
  refresh_token?: string
  token_type: string
  scope?: string
  expires_in: number
}

export async function deleteCookie(name: string): Promise<void> {
  const store = await cookies()
  // expires 과거로 설정하여 삭제
  store.set({
    name,
    value: "",
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
  })
}

/* ------------------------------------------------------------------ */
/* 서버 전용: 도메인 로직 헬퍼                                         */
/* ------------------------------------------------------------------ */
const ACCESS_KEY = "sp_access"
const REFRESH_KEY = "sp_refresh"

/** 액세스/리프레시 토큰 읽기 */
export async function getAccessCookie(): Promise<string | null> {
  return readCookie(ACCESS_KEY)
}
export async function getRefreshCookie(): Promise<string | null> {
  return readCookie(REFRESH_KEY)
}

/** 액세스/리프레시 토큰 쓰기 */
export async function setAccessCookie(
  token: string,
  expiresInSec?: number, // Spotify가 주는 expires_in(sec)
) {
  // 만료 60초 전에 재갱신 여유
  const maxAge = typeof expiresInSec === "number" ? Math.max(0, expiresInSec - 60) : undefined
  await writeCookie(ACCESS_KEY, token, { maxAge })
}
export async function setRefreshCookie(token: string) {
  // 리프레시 토큰은 길게(예: 30일) — 필요에 맞게 조정
  await writeCookie(REFRESH_KEY, token, { maxAge: 60 * 60 * 24 * 30 })
}
export async function clearSpotifyCookies() {
  await deleteCookie(ACCESS_KEY)
  await deleteCookie(REFRESH_KEY)
}

/** ---------- Spotify 토큰 갱신 API 호출 (서버 전용) ---------- */
type RefreshResponse = {
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
}

export async function refreshSpotifyToken(refreshToken: string) {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) throw new Error("Spotify client env vars are missing.")

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Failed to refresh token: ${res.status} ${text}`)
  }
  return (await res.json()) as RefreshResponse
}

/* ------------------------------------------------------------------ */
/* 클라이언트 전용: /api/spotify/me 상태 조회 (60초 캐시 + 중복 합치기) */
/* ------------------------------------------------------------------ */
// 이 부분은 브라우저에서만 호출하세요. (서버 렌더링에서 호출 금지)
let _spLast = 0
let _spCache: any = null
let _spInflight: Promise<any> | null = null

/**
 * 현재 사용자 Spotify 연결 상태를 조회합니다.
 * - 같은 탭에서 60초 동안 캐시됩니다.
 * - 동시에 여러 컴포넌트가 호출해도 한 번만 네트워크 요청이 나갑니다.
 */
export async function getSpotifyStatus() {
  if (typeof window === "undefined") {
    // SSR 중에 이 함수를 잘못 호출하면 네트워크를 치지 않도록 방어
    return { connected: false }
  }

  const now = Date.now()
  if (_spCache && now - _spLast < 60_000) return _spCache
  if (_spInflight) return _spInflight

  _spInflight = fetch("/api/spotify/me", { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) throw new Error("status " + r.status)
      const j = await r.json()
      _spCache = j
      _spLast = Date.now()
      return j
    })
    .finally(() => {
      _spInflight = null
    })

  return _spInflight
}
