// src/components/history/RankingsList.tsx
"use client"

import Image from "next/image"
import { useState, useRef, useEffect } from "react"
import { useRankings } from "@/hooks/useRankings"
import {
  Play,
  TrendingUp,
  TrendingDown,
  Minus,
  Heart,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react"
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

type RankingItem = {
  rank: number
  music_id: number
  play_count: number
  last_played: string | null
  rank_change: number | null
  day_rank_change?: number | null
  day_is_new?: boolean
  music_title: string | null
  music_artist: string | null
  music_genre: string | null
  album_image_url: string | null
}

function getDayChange(it: RankingItem): number | null {
  if (typeof it.day_rank_change !== "undefined") return it.day_rank_change ?? null
  return it.rank_change ?? null
}

function RankChange({ change, isNew }: { change: number | null; isNew?: boolean }) {
  if (isNew) {
    return (
      <div className="flex items-center gap-1 text-sm font-semibold text-purple-600">
        <Sparkles className="w-4 h-4" />
        <span className="tracking-wide">NEW</span>
      </div>
    )
  }
  if (!change) {
    return (
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Minus className="w-4 h-4" />
        <span>변동 없음</span>
      </div>
    )
  }
  if (change > 0) {
    return (
      <div className="flex items-center gap-1 text-sm font-semibold text-blue-500">
        <TrendingUp className="w-4 h-4" />
        <span className="tabular-nums">{change}위 상승</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 text-sm font-semibold text-red-500">
      <TrendingDown className="w-4 h-4" />
      <span className="tabular-nums">{Math.abs(change)}위 하락</span>
    </div>
  )
}

const ITEMS_PER_PAGE = 10
const TOTAL_ITEMS = 100

export default function RankingsList() {
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly")
  const { items, loading, error } = useRankings(period, TOTAL_ITEMS)

  const allItems: RankingItem[] = (items as RankingItem[] | undefined) ?? []

  const [currentPage, setCurrentPage] = useState(0)
  const totalPages = Math.ceil(allItems.length / ITEMS_PER_PAGE)

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

  const currentItems = allItems.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

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

      {!loading && !error && allItems.length === 0 && (
        <div className="text-sm text-muted-foreground px-1 py-12 text-center">집계된 차트가 없습니다.</div>
      )}

      {!loading && !error && allItems.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-muted-foreground">
              {currentPage * ITEMS_PER_PAGE + 1} - {Math.min((currentPage + 1) * ITEMS_PER_PAGE, allItems.length)} /{" "}
              {allItems.length}곡
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
              style={{ transform: `translateX(${translateX}px)` }}
            >
              {currentItems.map((it) => {
                const isTopThree = it.rank <= 3

                return (
                  <li
                    key={`${period}-${it.rank}-${it.music_id}`}
                    className="group flex flex-wrap items-center gap-4 rounded-xl px-4 py-3 hover:bg-accent/50 transition-all cursor-pointer"
                  >
                    {/* 랭크 번호 */}
                    <div className="flex items-center justify-center w-12 max-sm:w-8">
                      <div
                        className={`text-xl max-sm:text-base tabular-nums font-bold ${
                          isTopThree ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {it.rank}
                      </div>
                    </div>

                    {/* 앨범 아트 */}
                    <div className="relative w-16 h-16 max-sm:w-12 max-sm:h-12 rounded-lg overflow-hidden bg-muted flex-shrink-0 shadow-md">
                      {it.album_image_url ? (
                        <Image
                          src={it.album_image_url}
                          alt={it.music_title || "album"}
                          fill
                          sizes="(max-width: 640px) 48px, 64px"
                          className="object-cover"
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
                          aria-label="미리듣기"
                        >
                          <Play className="w-5 h-5 fill-current" />
                        </Button>
                      </div>
                    </div>

                    {/* 제목/가수 */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base max-sm:text-sm font-semibold truncate mb-1 group-hover:text-primary transition-colors">
                        {it.music_title || "제목 없음"}
                      </h3>
                      <div className="flex items-center gap-2 text-sm max-sm:text-xs text-muted-foreground">
                        <span className="truncate">{it.music_artist || "아티스트"}</span>
                      </div>
                    </div>

                    {/* 데스크톱: 오른쪽 고정 영역 */}
                    <div className="hidden sm:flex items-center gap-4">
                      <div className="flex items-center justify-center w-28">
                        <RankChange change={getDayChange(it)} isNew={it.day_is_new} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="w-9 h-9 hover:text-red-500" aria-label="좋아요">
                          <Heart className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="w-9 h-9" aria-label="더 보기">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* 모바일: 아래 줄 컴팩트 바 */}
                    <div className="flex sm:hidden items-center justify-between w-full mt-2">
                      <div className="flex items-center">
                        <RankChange change={getDayChange(it)} isNew={it.day_is_new} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="w-8 h-8 hover:text-red-500" aria-label="좋아요">
                          <Heart className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="w-8 h-8" aria-label="더 보기">
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
