// src/hooks/useRequestCounter.ts
"use client"
import { useEffect, useRef, useState } from "react"
import { API_BASE } from "@/lib/api"

export function useRequestCounter(title: string, artist: string, enable: boolean) {
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null) // 이전 요청 취소 컨트롤러

  useEffect(() => {
    // 요청 비활성화 또는 필수 파라미터 누락 시 초기화
    if (!enable || !title.trim() || !artist.trim()) {
      setCount(null)
      setLoading(false)
      return
    }

    // 이전 요청 중단 처리 및 새 요청 컨트롤러 설정
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    // 디바운싱 타이머 (300ms)
    const t = setTimeout(async () => {
      try {
        const url = `${API_BASE}/api/music-requests/count?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { count?: number }
        setCount(typeof data.count === "number" ? data.count : 0)
      } catch (err: unknown) {
        // 요청 취소 (Abort) 시 무시 처리
        if (err instanceof Error && err.name === "AbortError") return
        setCount(null)
      } finally {
        setLoading(false)
      }
    }, 300)

    // 클린업: 타이머 및 요청 취소
    return () => { clearTimeout(t); controller.abort() }
  }, [title, artist, enable])

  return { count, loading }
}