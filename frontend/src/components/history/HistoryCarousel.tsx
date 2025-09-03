"use client"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import Image from "next/image"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef } from "react"
import type { HistoryItem, UserInfo } from "@/types/music"

type Props = {
  user: UserInfo
  items: HistoryItem[]
  loading?: boolean
  error?: string | null
}

export default function HistoryCarousel({ user, items, loading, error }: Props) {
  const router = useRouter()
  const historyScrollRef = useRef<HTMLDivElement | null>(null)

  const scrollHistory = (dir: "left" | "right") => {
    const el = historyScrollRef.current
    if (!el) return
    const step = Math.round(el.clientWidth * 0.9)
    el.scrollBy({ left: dir === "left" ? -step : step, behavior: "smooth" })
  }

  return (
    <section className="mb-16">
      <div className="flex items-center mb-6">
        <div className="flex items-center space-x-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name || "user"} />
            <AvatarFallback className="bg-purple-600 text-white">
              {(user.name?.[0] || "U").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-2xl font-light text-gray-900">{(user.name || "사용자")}님의 추억</h3>
            <p className="text-gray-500 font-light">최근에 들었던 음악들</p>
          </div>
        </div>
        <div className="ml-auto hidden sm:block">
          <div className="flex gap-2">
            <Button variant="ghost" className="rounded-full" onClick={() => scrollHistory("left")} aria-label="왼쪽으로 이동">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={() => scrollHistory("right")} aria-label="오른쪽으로 이동">
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-16 border border-dashed rounded-lg bg-white/60">불러오는 중…</div>
      ) : error ? (
        <div className="text-center text-red-500 py-16 border border-dashed rounded-lg bg-white/60">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-center text-gray-500 py-16 border border-dashed rounded-lg bg-white/60">
          아직 추억이 없습니다.
        </div>
      ) : (
        <div className="relative">
          <div className="hidden sm:block">
            <Button
              variant="ghost"
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 rounded-full shadow"
              onClick={() => scrollHistory("left")}
              aria-label="왼쪽으로 이동"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 rounded-full shadow"
              onClick={() => scrollHistory("right")}
              aria-label="오른쪽으로 이동"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          <div
            ref={historyScrollRef}
            className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2
                      [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((item) => (
              <button
                key={item.id}
                className="min-w-[180px] sm:min-w-[200px] max-w-[220px] snap-start
                           bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow
                           transition-all p-3 text-left"
                onClick={() => router.push(`/recommend?picked=${encodeURIComponent(String(item.musicId ?? item.id))}`)}
                aria-label={`${item.title} 재생`}
              >
                <div className="relative w-full h-36 overflow-hidden rounded-xl">
                  <Image
                    src={item.image || "/placeholder.svg"}
                    alt={item.title}
                    fill
                    className="object-cover"
                    sizes="220px"
                  />
                </div>
                <div className="mt-3">
                  <p className="text-sm font-medium line-clamp-1">{item.title}</p>
                  {item.artist && <p className="text-xs text-gray-500 line-clamp-1">{item.artist}</p>}
                  {item.playedAt && <p className="text-[10px] text-gray-400 mt-1">{item.playedAt}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
