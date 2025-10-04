"use client"

import type React from "react"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
// import UserHeader from "@/components/header/UserHeader" // ⬅️ 사용 안 함 (헤더를 직접 렌더링)
import PhotoUpload from "@/components/upload/PhotoUpload"
import SearchAndRequest from "@/components/search/SearchAndRequest"
import MoodBadges from "@/components/mood/MoodBadges"
import { useAuthUser } from "@/hooks/useAuthUser"
import { useMusics } from "@/hooks/useMusics"
import { useHistory } from "@/hooks/useHistory"
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal"
import { API_BASE } from "@/lib/api"
import { Home, Search, User, Camera, BookOpen } from "lucide-react"

/* 이미지 URL 빌더 + 폴백 */
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

/* 환경 감지: 앱/웹뷰면 페이지, 일반 웹이면 오버레이 */
function usePreferOverlayOnSearch() {
  const [preferOverlay, setPreferOverlay] = useState(true)
  useEffect(() => {
    setPreferOverlay(true) // ✅ 모든 환경에서 오버레이 선호
  }, [])
  return preferOverlay
}

/* ───────────────── HistoryStrip (기존 그대로) ───────────────── */
function HistoryStrip({
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
        <h2 className="text-sm font-semibold text-foreground mb-3 px-4">최근 감정 분석</h2>
        <div className="text-destructive text-xs px-4">히스토리를 불러오지 못했습니다</div>
      </section>
    )
  }

  const list = items ?? []
  if (list.length === 0) {
    return (
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-3 px-4">최근 감정 분석</h2>
        <div className="text-muted-foreground text-xs px-4">아직 분석된 사진이 없어요</div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4 px-4">
        <h2 className="text-sm font-semibold text-foreground">최근 감정 분석</h2>
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
            const title = it.title_snapshot ?? it.title ?? "제목 없음"
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
                          const title = encodeURIComponent(it.title_snapshot ?? it.title ?? "제목 없음")
                          const artist = encodeURIComponent(it.artist_snapshot ?? it.artist ?? "Various")
                          const dateObj = extractDate(it)
                          const date = dateObj ? encodeURIComponent(dateObj.toISOString()) : ""
                          const idEnc = encodeURIComponent(String(pid))
                          window.location.href = `/diary/${idEnc}?title=${title}&artist=${artist}&date=${date}`
                        }}
                        className="w-full h-11 rounded-xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground text-sm font-semibold hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md"
                      >
                        <BookOpen className="w-4 h-4" />
                        그림일기 쓰기
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedIdx(null)
                        }}
                        className="w-full h-9 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground text-xs font-medium transition-colors"
                      >
                        취소
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

/* 하단 탭 */
function BottomNav({ activeTab, onOpenSearch }: { activeTab: string; onOpenSearch: () => void }) {
  const router = useRouter()

  const tabs = [
    { id: "home", label: "홈", icon: Home },
    { id: "search", label: "검색", icon: Search },
    { id: "profile", label: "프로필", icon: User },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 safe-area-inset-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === "home") router.push("/")
                if (tab.id === "profile") router.push("/account")
                if (tab.id === "search") onOpenSearch()
              }}
              className="flex flex-col items-center justify-center gap-1 flex-1 h-full"
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
              <span className={`text-[10px] ${isActive ? "text-primary font-medium" : "text-muted-foreground"}`}>
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default function Page() {
  const { user, isLoggedIn, logout } = useAuthUser()
  const router = useRouter()
  const { musics, loading: musicsLoading, error: musicsError } = useMusics()
  const { history, loading: historyLoading, error: historyError } = useHistory(isLoggedIn)
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)

  const preferOverlay = usePreferOverlayOnSearch()

  const accountId = useMemo(() => {
    const anyUser = (user ?? {}) as {
      email?: string | null
      id?: string | null
      uid?: string | null
      userId?: string | null
      name?: string | null
    }
    return (
      (anyUser.email?.trim() || null) ??
      (anyUser.id?.trim() || null) ??
      (anyUser.uid?.trim() || null) ??
      (anyUser.userId?.trim() || null) ??
      "guest"
    )
  }, [user])

  const dismissKey = useMemo(() => `spotify_connect_modal_dismissed_until::${accountId}`, [accountId])

  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false)
  const [showSpotifyModal, setShowSpotifyModal] = useState(false)

  useEffect(() => {
    const read = () => {
      try {
        const token = localStorage.getItem("spotify_access_token")
        const dismissedUntil = Number(localStorage.getItem(dismissKey) || "0")
        const now = Date.now()
        const connected = !!(token && token.trim())
        setIsSpotifyConnected(connected)
        setShowSpotifyModal(isLoggedIn ? !connected && now > dismissedUntil : false)
      } catch {
        setIsSpotifyConnected(false)
        setShowSpotifyModal(isLoggedIn)
      }
    }
    read()

    const onStorage = (e: StorageEvent) => {
      try {
        if (e.key === "spotify_access_token") {
          const connected = !!(e.newValue && e.newValue.trim())
          setIsSpotifyConnected(connected)
          if (connected) setShowSpotifyModal(false)
        }
        if (e.key === dismissKey) {
          const now = Date.now()
          const dismissedUntil = Number(localStorage.getItem(dismissKey) || "0")
          setShowSpotifyModal(isLoggedIn && !isSpotifyConnected && now > dismissedUntil)
        }
      } catch {}
    }

    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [dismissKey, isLoggedIn, isSpotifyConnected])

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
  }

  // 검색 탭 눌렀을 때 동작
  const handleOpenSearch = () => {
    // ✅ 항상 인라인 입력에 포커스 → onFocus가 오버레이를 띄움
    document.getElementById("global-search-input")?.focus()
  }

  return (
    <>
      <div className="min-h-screen bg-background pb-20">
        {/* 🔹 검은 헤더 */}
        <header className="sticky top-0 z-40 bg-black text-white shadow">
          {/* 1줄차: 로고/유저 영역 */}
          <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3">
            <h1
              className="text-xl font-bold leading-none cursor-pointer"
              onClick={() => router.push("/")}
            >
              MoodTune
            </h1>

            <div className="flex items-center gap-3 text-sm">
              {isLoggedIn ? (
                <>
                  <span className="text-white/90">{(user as any)?.name || "user"}</span>
                  <button
                    onClick={() => { logout(); router.push("/login") }}
                    className="text-white/70 hover:text-white transition"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <button
                  onClick={() => router.push("/login")}
                  className="text-white/70 hover:text-white transition"
                >
                  로그인
                </button>
              )}
            </div>
          </div>

          {/* 2줄차: ⬇️ 길~게 배치된 검색 바 (헤더 '아랫부분') */}
          <div className="max-w-5xl mx-auto px-4 pb-3">
            <SearchAndRequest
              size="wide"                 // ✅ 길이 확장
              musics={musics}
              loading={musicsLoading}
              error={musicsError}
              noOuterMargin
            />
          </div>
        </header>

        {/* 이하 메인 콘텐츠는 그대로 */}
        <main className="max-w-lg mx-auto">
          <div className="pt-4">
            <HistoryStrip user={user} items={history} loading={historyLoading} error={historyError} />
          </div>

          <section className="px-4 pb-4">
            <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 rounded-2xl p-6 mb-6">
              <h2 className="text-xl font-bold text-foreground mb-2 text-balance">당신의 감정을 음악으로</h2>
              <p className="text-sm text-muted-foreground mb-4 text-pretty">
                사진을 업로드하면 AI가 감정을 분석하고
                <br />딱 맞는 음악을 추천해드려요
              </p>
              <button
                onClick={() => setShowUploadModal(true)}
                className="w-full bg-primary text-primary-foreground rounded-lg py-3 px-4 font-medium text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
              >
                <Camera className="w-4 h-4" />
                사진으로 감정 분석하기
              </button>
            </div>
          </section>

          <section className="px-4 mb-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">지금 기분은?</h2>
            <MoodBadges selected={selectedGenres} onToggle={toggleGenre} />
          </section>
        </main>

        <button
          onClick={() => setShowUploadModal(true)}
          className="fixed bottom-20 right-4 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-40"
          aria-label="사진 업로드"
        >
          <Camera className="w-6 h-6" />
        </button>

        <BottomNav activeTab="home" onOpenSearch={handleOpenSearch} />
      </div>

      {/* 업로드 모달 */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl p-6 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">감정 분석하기</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <PhotoUpload
              isLoggedIn={isLoggedIn}
              selectedGenres={selectedGenres}
              onRequireLogin={() => {
                setShowUploadModal(false)
                router.push("/login")
              }}
            />
          </div>
        </div>
      )}

      <SpotifyConnectModal
        open={isLoggedIn && !isSpotifyConnected && showSpotifyModal}
        onClose={() => {
          try {
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
            const expireAt = Date.now() + sevenDaysMs
            localStorage.setItem(dismissKey, String(expireAt))
          } catch {}
          setShowSpotifyModal(false)
        }}
        onConnect={() => {
          window.location.href = "/account/spotify"
        }}
      />
    </>
  )
}
