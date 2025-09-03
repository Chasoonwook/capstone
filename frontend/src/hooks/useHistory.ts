"use client"
import { useEffect, useState } from "react"
import type { HistoryItem } from "@/types/music"
import { API_BASE } from "@/lib/api"
import { apiFetch } from "@/lib/fetcher"

export function useHistory(isLoggedIn: boolean) {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const run = async () => {
      if (!isLoggedIn) {
        setHistory([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const uid = localStorage.getItem("uid")
        if (!uid) {
          setHistory([])
          return
        }
        const res = await apiFetch(`${API_BASE}/api/history?user_id=${encodeURIComponent(uid)}`, { credentials: "include" })
        const rows = await res.json() as Array<{
          history_id: number | string
          music_id?: number | string
          photo_id?: number | string
          title: string
          artist?: string
          genre?: string | null
          label?: string | null
          selected_from?: string | null
          created_at?: string
        }>

        const mapped: HistoryItem[] = rows.map((r) => ({
          id: r.history_id,
          musicId: r.music_id,
          photoId: r.photo_id,
          title: r.title,
          artist: r.artist,
          genre: r.genre ?? null,
          label: r.label ?? null,
          selectedFrom: r.selected_from ?? null,
          playedAt: r.created_at,
          image: null,
        }))
        if (mounted) setHistory(mapped)
      } catch { // ✅ 변수 미사용이면 이름도 생략
        if (mounted) {
          setError("히스토리를 불러오지 못했습니다.")
          setHistory([])
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => { mounted = false }
  }, [isLoggedIn])

  return { history, loading, error }
}
