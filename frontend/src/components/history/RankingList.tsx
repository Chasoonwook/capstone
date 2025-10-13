// src/components/history/RankingsList.tsx
"use client"

import Image from "next/image"
import { useState, useRef, useEffect } from "react"
import { useRankings } from "@/hooks/useRankings"
import { Play, TrendingUp, TrendingDown, Minus, Heart, MoreVertical, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

function timeAgo(iso?: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

function RankChange({ rank }: { rank: number }) {
  // Simulate rank change (in real app, this would come from data)
  const change = Math.floor(Math.random() * 10) - 3

  if (change > 0) {
    return (
      <div className="flex items-center gap-0.5 text-[10px] font-semibold text-blue-500">
        <TrendingUp className="w-3 h-3" />
        <span>{change}</span>
      </div>
    )
  } else if (change < 0) {
    return (
      <div className="flex items-center gap-0.5 text-[10px] font-semibold text-red-500">
        <TrendingDown className="w-3 h-3" />
        <span>{Math.abs(change)}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center text-[10px] text-muted-foreground">
      <Minus className="w-3 h-3" />
    </div>
  )
}

const ITEMS_PER_PAGE = 10
const TOTAL_ITEMS = 100

export default function RankingsList() {
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly")
  const { items, loading, error } = useRankings(period, TOTAL_ITEMS)

  const [currentPage, setCurrentPage] = useState(0)
  const totalPages = Math.ceil((items?.length || 0) / ITEMS_PER_PAGE)

  const containerRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)
  const isDraggingRef = useRef(false)
  const [translateX, setTranslateX] = useState(0)

  useEffect(() => {
    setCurrentPage(0)
    setTranslateX(0)
  }, [period])

  const handleStart = (clientX: number) => {
    startXRef.current = clientX
    isDraggingRef.current = true
  }

  const handleMove = (clientX: number) => {
    if (!isDraggingRef.current) return
    const diff = clientX - startXRef.current
    setTranslateX(diff)
  }

  const handleEnd = () => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    const threshold = 80
    if (translateX > threshold && currentPage > 0) {
      setCurrentPage((prev) => prev - 1)
    } else if (translateX < -threshold && currentPage < totalPages - 1) {
      setCurrentPage((prev) => prev + 1)
    }
    setTranslateX(0)
  }

  const currentItems = items?.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE) || []

  return (
    <section className="px-4 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">인기 차트</h2>
          <p className="text-sm text-muted-foreground">함께 만들어가는 추억의 음악 TOP 100</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg bg-muted p-1">
            <button
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                period === "weekly"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPeriod("weekly")}
            >
              주간
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                period === "monthly"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPeriod("monthly")}
            >
              월간
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground px-1 py-12 text-center">차트를 불러오는 중…</div>}
      {error && <div className="text-sm text-red-500 px-1 py-12 text-center">불러오기 실패: {error}</div>}

      {!loading && !error && items && items.length === 0 && (
        <div className="text-sm text-muted-foreground px-1 py-12 text-center">집계된 차트가 없습니다.</div>
      )}

      {!loading && !error && items && items.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-muted-foreground">
              {currentPage * ITEMS_PER_PAGE + 1} - {Math.min((currentPage + 1) * ITEMS_PER_PAGE, items.length)} /{" "}
              {items.length}곡
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="w-8 h-8 bg-transparent"
                onClick={() => setCurrentPage((prev) => Math.max(0, prev - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }).map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentPage(idx)}
                    className={`w-2 h-2 rounded-full transition-all ${
                      idx === currentPage ? "bg-primary w-6" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                    }`}
                    aria-label={`${idx + 1}페이지로 이동`}
                  />
                ))}
              </div>
              <Button
                size="icon"
                variant="outline"
                className="w-8 h-8 bg-transparent"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1))}
                disabled={currentPage === totalPages - 1}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div
            ref={containerRef}
            className="overflow-hidden touch-pan-y"
            onTouchStart={(e) => handleStart(e.touches[0].clientX)}
            onTouchMove={(e) => handleMove(e.touches[0].clientX)}
            onTouchEnd={handleEnd}
            onMouseDown={(e) => handleStart(e.clientX)}
            onMouseMove={(e) => e.buttons === 1 && handleMove(e.clientX)}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
          >
            <ul
              className="space-y-1 transition-transform duration-300 ease-out"
              style={{
                transform: `translateX(${translateX}px)`,
              }}
            >
              {currentItems.map((it, idx) => {
                const isTopThree = it.rank <= 3

                return (
                  <li
                    key={`${period}-${it.rank}-${it.music_id}`}
                    className="group flex items-center gap-4 rounded-xl px-4 py-3 hover:bg-accent/50 transition-all cursor-pointer"
                  >
                    <div className="flex flex-col items-center gap-1 w-12">
                      <div
                        className={`text-xl tabular-nums font-bold ${isTopThree ? "text-primary" : "text-foreground"}`}
                      >
                        {it.rank}
                      </div>
                      <RankChange rank={it.rank} />
                    </div>

                    <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 shadow-md">
                      {it.album_image_url ? (
                        <Image
                          src={it.album_image_url || "/placeholder.svg"}
                          alt={it.music_title || "album"}
                          width={64}
                          height={64}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-muted to-muted-foreground/20" />
                      )}

                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-10 h-10 rounded-full bg-white/90 hover:bg-white text-black hover:scale-110 transition-transform"
                        >
                          <Play className="w-5 h-5 fill-current" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold truncate mb-1 group-hover:text-primary transition-colors">
                        {it.music_title || "제목 없음"}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="truncate">{it.music_artist || "아티스트"}</span>
                        {it.music_genre && (
                          <>
                            <span className="text-xs">•</span>
                            <span className="text-xs">{it.music_genre}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium tabular-nums">{it.play_count.toLocaleString()}회</p>
                        <p className="text-xs text-muted-foreground">{timeAgo(it.last_played)}</p>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="w-9 h-9 hover:text-red-500">
                          <Heart className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="w-9 h-9">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
