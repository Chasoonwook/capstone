// src/hooks/useRankings.ts
"use client"

import { useEffect, useMemo, useState } from "react"
import { API_BASE } from "@/lib/api"

export type RankingItem = {
  rank: number
  music_id: number
  play_count: number
  last_played: string | null
  music_title: string | null
  music_artist: string | null
  music_genre: string | null
  album_image_url: string | null
}

export type RankingsResponse = {
  period: "weekly" | "monthly"
  items: any[] // 서버 응답을 먼저 받고 아래 normalize에서 정제
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

  // 장르 키 호환
  const genre =
    raw?.music_genre ??
    raw?.genre ??
    null

  // 앨범 이미지 키 호환
  const albumImage =
    raw?.album_image_url ??
    raw?.album_image ??
    raw?.albumImage ??
    null

  return {
    rank: Number(raw?.rank ?? 0),
    music_id: Number(raw?.music_id ?? raw?.id ?? 0),
    play_count: Number(raw?.play_count ?? raw?.count ?? 0),
    last_played: raw?.last_played ?? null,
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
  // 1순위: /api/rankings/*  2순위: /api/rankings-simple/*
  const paths = [
    `/api/rankings/${period}?limit=${limit}`,
    `/api/rankings-simple/${period}?limit=${limit}`,
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

      const j: RankingsResponse = await r.json()
      const rows = Array.isArray(j?.items) ? j.items : []
      return rows.map(normalizeRow)
    } catch (e) {
      lastErr = e
    }
  }

  throw lastErr ?? new Error("failed_to_fetch_rankings")
}

export function useRankings(period: "weekly" | "monthly", limit = 50) {
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
