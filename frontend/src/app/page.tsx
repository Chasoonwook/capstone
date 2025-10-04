"use client"

import { Suspense,useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import PhotoUpload from "@/components/upload/PhotoUpload"
import MoodBadges from "@/components/mood/MoodBadges"
import { useAuthUser } from "@/hooks/useAuthUser"
import { useMusics } from "@/hooks/useMusics"
import { useHistory } from "@/hooks/useHistory"
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal"

import Header from "@/components/header/Header"
import HistorySwitch from "@/components/history/HistorySwitch"

import { Home, Search, User, Camera } from "lucide-react"

/* ───────────────── 하단 탭 ───────────────── */
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

  // 하단 탭의 "검색" 클릭 시 헤더의 검색 오버레이 열기
  const handleOpenSearch = () => {
    const el = document.getElementById("global-search-input") as HTMLInputElement | null
    if (el) {
      try {
        el.focus()
      } catch {}
    }
    window.dispatchEvent(new Event("open-search-overlay"))
  }

  return (
    <>
      <div className="min-h-screen bg-background pb-20">
        {/* ✅ 상단 헤더: 로고/계정 + 검색창 + 탭 네비게이션 */}
        <Header
          user={user}
          isLoggedIn={isLoggedIn}
          onLogout={() => {
            logout()
            router.push("/login")
          }}
          musics={musics}
          loading={musicsLoading}
          error={musicsError}
        />

        {/* 메인 콘텐츠 */}
        <main className="max-w-lg mx-auto">
          {/* 탭에 따라 섹션 전환 */}
          <div className="pt-4">
            <Suspense fallback={<div className="px-4 text-sm text-muted-foreground">로딩 중…</div>}>
              <HistorySwitch
                user={user}
                history={history}
                loading={historyLoading}
                error={historyError}
              />
            </Suspense>
          </div>

          {/* 업로드 CTA 섹션 */}
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

          {/* 기분 배지 */}
          <section className="px-4 mb-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">지금 기분은?</h2>
            <MoodBadges selected={selectedGenres} onToggle={toggleGenre} />
          </section>
        </main>

        {/* 우측 하단 업로드 FAB */}
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

      {/* Spotify 연결 안내 모달 */}
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
