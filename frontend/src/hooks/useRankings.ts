// src/hooks/useRankings.ts
"use client"

import { useEffect, useMemo, useState } from "react"
import { API_BASE } from "@/lib/api"

export type RankingItem = {
  rank: number
  music_id: number
  play_count: number
  last_played: string | null
  /** 직전 기간 대비 순위 변화량 (양수: 상승, 음수: 하락, null: 신규 진입) */
  rank_change: number | null
  music_title: string | null
  music_artist: string | null
  music_genre: string | null
  album_image_url: string | null
}

/** 서버 응답 데이터 UI용 정규화 처리 */
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

  // 백엔드 응답 필드 우선순위 처리 및 호환성 확보
  const rc =
    raw?.rank_change ??
    raw?.change ??
    raw?.delta ??
    raw?.diff ??
    null

  // 비수치 데이터 예외 처리
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
    rank_change: rankChange, // 데이터 부재 시 null
    music_title: title ?? "No Title",
    music_artist: artist ?? "",
    music_genre: genre,
    album_image_url: albumImage,
  }
}

async function fetchRankings(
  period: "weekly" | "monthly",
  limit: number,
): Promise<RankingItem[]> {
  // 1순위 API 경로 (신규, 순위 변화량 포함)
  // 2순위 API 경로 (구버전, 변화량 미포함)
  const paths = [
    `/api/rankings/${period}?limit=${Math.max(1, Math.min(limit, 100))}`,
    `/api/rankings-simple/${period}?limit=${Math.max(1, Math.min(limit, 100))}`,
  ]

  let lastErr: unknown = null

  for (const p of paths) {
    try {
      const r = await fetch(`${API_BASE}${p}`, { credentials: "include" })
      if (r.status === 404) {
        lastErr = new Error("Rankings not found")
        continue
      }
      if (!r.ok) throw new Error(`HTTP Error ${r.status}`)

      // 배열 및 객체 형태 응답 처리
      const j = await r.json()
      const rows = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : []
      return rows.map(normalizeRow)
    } catch (e) {
      lastErr = e
    }
  }

  throw lastErr ?? new Error("Failed to fetch rankings")
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
          setError(e?.message ?? "Failed to fetch rankings")
          setLoading(false)
        }
      })

    return () => {
      aborted = true
    }
  }, [memoKey])

  return { items, loading, error }
}