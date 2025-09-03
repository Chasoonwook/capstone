"use client"
import { useEffect, useState } from "react"
import type { MusicItem } from "@/types/music"
import { API_BASE } from "@/lib/api"
import { apiFetch } from "@/lib/fetcher"

export function useMusics() {
  const [musics, setMusics] = useState<MusicItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await apiFetch(`${API_BASE}/api/musics`)
        const data = (await res.json()) as MusicItem[]
        if (mounted) setMusics(data)
      } catch (err: unknown) { // ✅ any 금지
        if (mounted) {
          const msg = err instanceof Error ? err.message : "음악 목록을 불러오지 못했습니다."
          setError(msg)
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => { mounted = false }
  }, [])

  return { musics, loading, error }
}
