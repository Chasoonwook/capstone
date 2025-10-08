// src/app/api/spotify/search/route.ts
import { NextResponse } from "next/server"

export const runtime = "nodejs"

/** ---------- 타입 ---------- */
type TokenResp = { access_token: string; expires_in?: number }

type SpotifyArtist = { name: string }
type SpotifyImage = { url: string; height?: number; width?: number }
type SpotifyAlbum = { id?: string; name?: string; images?: SpotifyImage[] }
type SpotifyTrack = {
  id: string
  name: string
  artists: SpotifyArtist[]
  album?: SpotifyAlbum
}
type SpotifySearchResponseFromSpotify = { tracks?: { items?: SpotifyTrack[]; total?: number } }

/** ---------- 유틸 ---------- */
function buildBaseUrlFromRequest(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const host = req.headers.get("host") ?? "localhost:3000"
  return `${proto}://${host}`
}

async function fetchTokenViaInternal(baseUrl: string): Promise<string> {
  const r = await fetch(`${baseUrl}/api/spotify/token`, { cache: "no-store" })
  // ✅ 200만 성공으로 간주 (204/401 등은 실패 → 폴백)
  if (r.status !== 200) throw new Error(`internal_token_${r.status}`)
  const j = (await r.json()) as TokenResp
  if (!j?.access_token) throw new Error("internal_token_empty")
  return j.access_token
}

async function fetchTokenDirect(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID!
  const secret = process.env.SPOTIFY_CLIENT_SECRET!
  if (!id || !secret) throw new Error("env_missing")

  const basic = Buffer.from(`${id}:${secret}`).toString("base64")
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`direct_token_${r.status}:${t}`)
  }
  const j = (await r.json()) as TokenResp
  return j.access_token
}

async function getToken(baseUrl: string): Promise<string> {
  try {
    return await fetchTokenViaInternal(baseUrl)
  } catch {
    return await fetchTokenDirect()
  }
}

function buildQuery(title?: string | null, artist?: string | null, query?: string | null) {
  if (query && query.trim()) return query.trim()
  const parts: string[] = []
  if (title?.trim()) parts.push(`track:${title.trim()}`)
  if (artist?.trim()) parts.push(`artist:${artist.trim()}`)
  return parts.join(" ")
}

async function doSearch(token: string, q: string, limit = 5) {
  const url = new URL("https://api.spotify.com/v1/search")
  url.searchParams.set("q", q)
  url.searchParams.set("type", "track")
  url.searchParams.set("limit", String(limit))
  return fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
}

/** ---------- 핸들러 ---------- */
export async function GET(req: Request) {
  try {
    const baseUrl = buildBaseUrlFromRequest(req)
    const { searchParams } = new URL(req.url)
    const title = searchParams.get("title")
    const artist = searchParams.get("artist")
    const query = searchParams.get("query")
    const limit = Number(searchParams.get("limit") ?? 5)

    const q = buildQuery(title, artist, query)
    if (!q) return NextResponse.json({ items: [] })

    let token = await getToken(baseUrl)
    let res = await doSearch(token, q, limit)

    // 토큰 만료 등 401이면 1회 재시도
    if (res.status === 401) {
      token = await getToken(baseUrl)
      res = await doSearch(token, q, limit)
    }

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json(
        { error: "spotify_search_failed", status: res.status, detail: txt, q },
        { status: 500 },
      )
    }

    const js = (await res.json()) as SpotifySearchResponseFromSpotify

    // ✅ 프런트가 기대하는 구조로 맞춰서 반환 (album.images 배열 그대로 유지)
    const items =
      js.tracks?.items?.map((t) => ({
        id: t.id,
        name: t.name,
        album: {
          id: t.album?.id,
          name: t.album?.name,
          images: (t.album?.images || []).map((i) => ({
            url: i.url,
            width: i.width,
            height: i.height,
          })),
        },
      })) ?? []

    return NextResponse.json({ items })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || "search_error" }, { status: 500 })
  }
}
