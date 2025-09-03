"use client"
import { useEffect, useRef, useState } from "react"
import { API_BASE } from "@/lib/api"

export function useRequestCounter(title: string, artist: string, enable: boolean) {
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!enable || !title.trim() || !artist.trim()) {
      setCount(null)
      setLoading(false)
      return
    }
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    const t = setTimeout(async () => {
      try {
        const url = `${API_BASE}/api/music-requests/count?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { count?: number }
        setCount(typeof data.count === "number" ? data.count : 0)
      } catch (e: any) {
        if (e?.name !== "AbortError") setCount(null)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => { clearTimeout(t); controller.abort() }
  }, [title, artist, enable])

  return { count, loading }
}
