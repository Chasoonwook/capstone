// src/lib/spotifyClient.ts
// 브라우저에서만 사용하세요. (SSR에서 호출 금지)

let _spLast = 0
let _spCache: any = null
let _spInflight: Promise<any> | null = null

/** /api/spotify/me 상태 조회 — 60초 캐시 + 중복요청 합치기 */
export async function getSpotifyStatus() {
  if (typeof window === "undefined") return { connected: false }

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
