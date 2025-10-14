// src/hooks/useRankings.ts
"use client"

import { useEffect, useMemo, useState } from "react"
import { API_BASE } from "@/lib/api"

export type RankingItem = {
  rank: number
  music_id: number
  play_count: number
  last_played: string | null
  /** 직전 기간 대비 변화량: (prev_rank - rank)
   *  양수 => 순위 상승, 음수 => 하락, null => 신규/비교 불가
   */
  rank_change: number | null
  music_title: string | null
  music_artist: string | null
  music_genre: string | null
  album_image_url: string | null
}

/** 서버 응답을 UI에서 쓰기 쉬운 형태로 정규화 */
function normalizeRow(raw: any): RankingItem {
  const title =
    raw?.music_title ??
    raw?.title ??
    null

  const artist =
    raw?.music_artist ??
    raw?.artist ??
    null

  const genre =
    raw?.music_genre ??
    raw?.genre ??
    null

  const albumImage =
    raw?.album_image_url ??
    raw?.album_image ??
    raw?.albumImage ??
    null

  const rank = Number(raw?.rank ?? 0)
  const musicId = Number(raw?.music_id ?? raw?.id ?? 0)
  const playCount = Number(raw?.play_count ?? raw?.count ?? 0)
  const lastPlayed = raw?.last_played ?? null

  // 백엔드가 내려주는 우선 키: rank_change
  // 호환: change, delta, diff 등(혹시 다른 이름을 썼을 경우 대비)
  const rc =
    raw?.rank_change ??
    raw?.change ??
    raw?.delta ??
    raw?.diff ??
    null

  // 숫자 이외 값 방어
  const rankChange =
    rc === null || rc === undefined
      ? null
      : Number.isFinite(Number(rc))
      ? Number(rc)
      : null

  return {
    rank,
    music_id: musicId,
    play_count: playCount,
    last_played: lastPlayed,
    rank_change: rankChange, // 없으면 null
    music_title: title ?? "제목 없음",
    music_artist: artist ?? "",
    music_genre: genre,
    album_image_url: albumImage,
  }
}

async function fetchRankings(
  period: "weekly" | "monthly",
  limit: number,
): Promise<RankingItem[]> {
  // 1순위: /api/rankings/* (신규, rank_change 포함)
  // 2순위: /api/rankings-simple/* (구형, 변화량 없음)
  const paths = [
    `/api/rankings/${period}?limit=${Math.max(1, Math.min(limit, 100))}`,
    `/api/rankings-simple/${period}?limit=${Math.max(1, Math.min(limit, 100))}`,
  ]

  let lastErr: unknown = null

  for (const p of paths) {
    try {
      const r = await fetch(`${API_BASE}${p}`, { credentials: "include" })
      if (r.status === 404) {
        lastErr = new Error("not_found")
        continue
      }
      if (!r.ok) throw new Error(`HTTP_${r.status}`)

      // 응답이 배열이거나 {items: [...]} 둘 다 수용
      const j = await r.json()
      const rows = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : []
      return rows.map(normalizeRow)
    } catch (e) {
      lastErr = e
    }
  }

  throw lastErr ?? new Error("failed_to_fetch_rankings")
}

export function useRankings(period: "weekly" | "monthly", limit = 100) {
  const [items, setItems] = useState<RankingItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const memoKey = useMemo(() => `${period}:${limit}`, [period, limit])

  useEffect(() => {
    let aborted = false
    setLoading(true)
    setError(null)

    fetchRankings(period, limit)
      .then((rows) => {
        if (!aborted) {
          setItems(rows)
          setLoading(false)
        }
      })
      .catch((e: any) => {
        if (!aborted) {
          setError(e?.message ?? "failed_to_fetch_rankings")
          setLoading(false)
        }
      })

    return () => {
      aborted = true
    }
  }, [memoKey])

  return { items, loading, error }
}
