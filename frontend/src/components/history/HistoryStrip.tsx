"use client"

import React, { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api"
import { BookOpen } from "lucide-react"

/* 이미지 URL 빌더 + 폴백 주석 유지 */
const buildPhotoSrc = (photoId: string | number) => {
  const id = encodeURIComponent(String(photoId))
  return {
    primary: `${API_BASE}/api/photos/${id}/binary`,
    fallback: `${API_BASE}/photos/${id}/binary`,
  }
}

function extractDate(item: any): Date | null {
  const v =
    item?.created_at ??
    item?.createdAt ??
    item?.history_created_at ??
    item?.saved_at ??
    item?.analyzed_at ??
    item?.updated_at ??
    item?.timestamp ??
    item?.date ??
    item?.time ??
    null

  if (v == null) return null
  const d = typeof v === "number" ? new Date(v) : new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

const fmtDateBadge = (d: Date) =>
  d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })

/* ───────────────── HistoryStrip 컴포넌트 ───────────────── */
export default function HistoryStrip({
  user,
  items,
  loading,
  error,
}: {
  user: any
  items: any[] | undefined
  loading: boolean
  error: string | null
}) {
  const router = useRouter()
  const trackRef = useRef<HTMLDivElement | null>(null)

  const [active, setActive] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [sideGap, setSideGap] = useState(0)

  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const scrollStartX = useRef(0)
  const movedRef = useRef(false)

  const rafIdRef = useRef<number | null>(null)
  const lastLeftRef = useRef(0)
  const lastTsRef = useRef(0)
  const runningRef = useRef(false)

  const EDGE_GUTTER = 24

  const computeActive = () => {
    const track = trackRef.current
    if (!track) return 0
    const cards = Array.from(track.querySelectorAll<HTMLElement>("[data-card-idx]"))
    if (!cards.length) return 0

    const trackRect = track.getBoundingClientRect()
    const trackCenterX = trackRect.left + track.clientWidth / 2

    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    cards.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const cardCenterX = r.left + r.width / 2
      const dist = Math.abs(cardCenterX - trackCenterX)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return best
  }

  const ensureRafLoop = () => {
    const track = trackRef.current
    if (!track || runningRef.current) return
    runningRef.current = true
    const tick = () => {
      const t = trackRef.current
      if (!t) {
        runningRef.current = false
        return
      }
      const now = performance.now()
      const left = t.scrollLeft

      const idx = computeActive()
      setActive((p) => (p === idx ? p : idx))

      if (left !== lastLeftRef.current) {
        lastLeftRef.current = left
        lastTsRef.current = now
      }
      if (now - lastTsRef.current < 120) {
        rafIdRef.current = requestAnimationFrame(tick)
      } else {
        runningRef.current = false
        rafIdRef.current = null
      }
    }

    lastLeftRef.current = track.scrollLeft
    lastTsRef.current = performance.now()
    rafIdRef.current = requestAnimationFrame(tick)
  }

  const measureSideGap = () => {
    const track = trackRef.current
    if (!track) return
    const first = track.querySelector<HTMLElement>("[data-card-idx='0']")
    if (!first) {
      setSideGap(0)
      return
    }
    const gap = Math.max(0, (track.clientWidth - first.offsetWidth) / 2)
    setSideGap(gap)
  }

  const scrollToCardIfFar = (idx: number, threshold = 12) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector<HTMLElement>(`[data-card-idx="${idx}"]`)
    if (!card) return

    const trackRect = track.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const trackCenterX = trackRect.left + track.clientWidth / 2
    const cardCenterX = cardRect.left + cardRect.width / 2

    const delta = cardCenterX - trackCenterX
    if (Math.abs(delta) <= threshold) return
    track.scrollTo({ left: track.scrollLeft + delta, behavior: "smooth" })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    const track = trackRef.current
    if (!track) return
    setIsDragging(true)
    movedRef.current = false
    dragStartX.current = e.pageX
    scrollStartX.current = track.scrollLeft
    track.style.scrollBehavior = "auto"
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    const track = trackRef.current
    if (!track) return
    e.preventDefault()
    const x = e.pageX
    const walk = (dragStartX.current - x) * 1.5
    if (Math.abs(walk) > 6) movedRef.current = true
    track.scrollLeft = scrollStartX.current + walk
  }

  const endDrag = () => {
    const track = trackRef.current
    if (track) track.style.scrollBehavior = "smooth"
    setIsDragging(false)
    movedRef.current = false
  }
  const handleMouseUp = endDrag
  const handleMouseLeave = () => {
    if (isDragging) endDrag()
  }

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const onScroll = () => ensureRafLoop()
    const onResize = () => {
      measureSideGap()
      setActive(computeActive())
    }
    track.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onResize)

    measureSideGap()
    requestAnimationFrame(() => setActive(computeActive()))

    return () => {
      track.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onResize)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  if (loading) {
    return (
      <section className="mb-6">
        <div className="h-5 w-32 rounded bg-muted animate-pulse mb-3 ml-4" />
        <div className="flex gap-4 overflow-hidden px-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-[160px] shrink-0">
              <div className="aspect-[3/4] rounded bg-muted animate-pulse mb-2" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-3 px-4">Recent Emotion Analysis</h2>
        <div className="text-destructive text-xs px-4">Failed to load history</div>
      </section>
    )
  }

  const list = items ?? []
  if (list.length === 0) {
    return (
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-3 px-4">Recent Emotion Analysis</h2>
        <div className="text-muted-foreground text-xs px-4">No analyzed photos yet</div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4 px-4">
        <h2 className="text-sm font-semibold text-foreground">Recent Emotion Analysis</h2>
      </div>

      <div
        ref={trackRef}
        className={`overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden touch-pan-x select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          paddingLeft: sideGap + EDGE_GUTTER,
          paddingRight: sideGap + EDGE_GUTTER,
          paddingTop: 12,
          paddingBottom: 4,
          scrollBehavior: "smooth",
          WebkitOverflowScrolling: "touch",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex gap-4 pb-3" style={{ minWidth: "max-content" }}>
          {list.map((it, idx) => {
            const pid = it.photo_id ?? it.photoId ?? it.id
            const { primary, fallback } = buildPhotoSrc(pid)
            const title = it.title_snapshot ?? it.title ?? "Untitled"
            const artist = it.artist_snapshot ?? it.artist ?? "Various"
            const dateObj = extractDate(it)

            const centered = idx === active
            const picked = idx === selectedIdx

            const scale = picked ? "scale(1.05)" : centered ? "scale(1.05)" : "scale(0.95)"
            const opacity = picked ? 1 : 0.6
            const gray = picked ? "none" : "grayscale(60%)"
            const ringCls = picked ? "ring-2 ring-primary ring-offset-2" : ""

            return (
              <div
                key={`${pid}-${idx}`}
                data-card-idx={idx}
                className="snap-center shrink-0 w-[160px] transition-all duration-300"
                style={{
                  transform: scale,
                  zIndex: picked || centered ? 10 : 1,
                  opacity,
                }}
                onClick={() => {
                  if (isDragging || movedRef.current) return
                  setSelectedIdx((prev) => (prev === idx ? null : idx))
                  scrollToCardIfFar(idx, 12)
                }}
              >
                <div
                  className={`relative bg-white p-3 pb-8 shadow-lg transition-all duration-300 cursor-pointer rounded-xl ${ringCls}`}
                  style={{ filter: gray as any }}
                >
                  <div className="relative aspect-square overflow-hidden bg-gray-100 rounded-lg">
                    <img
                      src={primary || "/placeholder.svg"}
                      alt={title}
                      className="w-full h-full object-cover"
                      crossOrigin="anonymous"
                      style={{ pointerEvents: "none" }}
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement
                        if (!(img as any).__fb) {
                          ;(img as any).__fb = true
                          img.src = fallback
                        } else {
                          img.src = "/placeholder.svg"
                        }
                      }}
                    />
                    {dateObj && (
                      <span className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/70 text-white text-[10px] leading-tight">
                        {fmtDateBadge(dateObj)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-center">
                    <div className="text-xs font-medium text-gray-800 truncate">{title}</div>
                    <div className="text-[10px] text-gray-500 truncate">{artist}</div>
                  </div>

                  {idx === selectedIdx && (
                    <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          const pid = it.photo_id ?? it.photoId ?? it.id
                          const title = encodeURIComponent(it.title_snapshot ?? it.title ?? "Untitled")
                          const artist = encodeURIComponent(it.artist_snapshot ?? it.artist ?? "Various")
                          const dateObj = extractDate(it)
                          const date = dateObj ? encodeURIComponent(dateObj.toISOString()) : ""
                          const idEnc = encodeURIComponent(String(pid))
                          window.location.href = `/diary/${idEnc}?title=${title}&artist=${artist}&date=${date}`
                        }}
                        className="w-full h-11 rounded-xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground text-sm font-semibold hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md"
                      >
                        <BookOpen className="w-4 h-4" />
                        Write Diary
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedIdx(null)
                        }}
                        className="w-full h-9 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
