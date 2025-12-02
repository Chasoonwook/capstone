// src/lib/spotify.ts
import { cookies } from "next/headers"

/* ------------------------------------------------------------------ */
/* 서버 전용: 쿠키 유틸리티                                          */
/* ------------------------------------------------------------------ */
/** cookies() 비동기 처리 */
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

  // 토큰 교환 요청
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
  // 쿠키 만료일 과거 설정으로 삭제
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
/* 서버 전용: 도메인 로직 헬퍼                                         */
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
  expiresInSec?: number, // Spotify 토큰 만료 시간 (초)
) {
  // 만료 60초 전 재갱신 여유 시간 설정
  const maxAge = typeof expiresInSec === "number" ? Math.max(0, expiresInSec - 60) : undefined
  await writeCookie(ACCESS_KEY, token, { maxAge })
}
export async function setRefreshCookie(token: string) {
  // 리프레시 토큰 장기 보존 (30일)
  await writeCookie(REFRESH_KEY, token, { maxAge: 60 * 60 * 24 * 30 })
}
export async function clearSpotifyCookies() {
  await deleteCookie(ACCESS_KEY)
  await deleteCookie(REFRESH_KEY)
}

/** Spotify 토큰 갱신 API 호출 (서버 전용) */
type RefreshResponse = {
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
}

export async function refreshSpotifyToken(refreshToken: string) {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) throw new Error("Spotify client environment variables are missing.")

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })

  // 토큰 갱신 요청
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
/* 클라이언트 전용: /api/spotify/me 상태 조회 (캐시 로직 포함)            */
/* ------------------------------------------------------------------ */
let _spLast = 0 // 마지막 캐시 시간
let _spCache: any = null // 캐시된 데이터
let _spInflight: Promise<any> | null = null // 진행 중인 요청

/**
 * 현재 사용자 Spotify 연결 상태 조회
 * - 60초 캐시 및 중복 요청 통합 처리
 */
export async function getSpotifyStatus() {
  // SSR 환경에서 호출 방지
  if (typeof window === "undefined") {
    return { connected: false }
  }

  const now = Date.now()
  // 캐시 유효성 검사 (60초)
  if (_spCache && now - _spLast < 60_000) return _spCache
  // 진행 중인 요청 반환
  if (_spInflight) return _spInflight

  // 신규 요청 시작
  _spInflight = fetch("/api/spotify/me", { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) throw new Error("Status " + r.status)
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