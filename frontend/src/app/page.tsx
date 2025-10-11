"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import PhotoUpload from "@/components/upload/PhotoUpload"
import MoodBadges from "@/components/mood/MoodBadges"
import { useAuthUser } from "@/hooks/useAuthUser"
import { useMusics } from "@/hooks/useMusics"
import { useHistory } from "@/hooks/useHistory"
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal"

import Header from "@/components/header/Header"
import HistorySwitch from "@/components/history/HistorySwitch"

import {
  Camera,
  Home,
  Music2,
  SkipBack,
  Play,
  SkipForward,
  ListMusic,
  Volume2,
} from "lucide-react"
import { API_BASE } from "@/lib/api"
import { getSpotifyStatus, invalidateSpotifyStatus } from "../lib/spotifyClient" // 클라이언트 전용

export default function Page() {
  const { user, isLoggedIn, logout } = useAuthUser()
  const router = useRouter()

  const { musics, loading: musicsLoading, error: musicsError } = useMusics()
  const { history, loading: historyLoading, error: historyError } = useHistory(isLoggedIn)

  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)

  const accountId = useMemo(() => {
    const anyUser = (user ?? {}) as any
    return (
      anyUser.email?.trim() ||
      anyUser.id?.trim() ||
      anyUser.uid?.trim() ||
      anyUser.userId?.trim() ||
      "guest"
    )
  }, [user])

  const dismissKey = useMemo(
    () => `spotify_connect_modal_dismissed_until::${accountId}`,
    [accountId],
  )

  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false)
  const [showSpotifyModal, setShowSpotifyModal] = useState(false)

  // 추천 화면에서 내려왔을 때만 하단 내비 보이기
  const [showNav, setShowNav] = useState(false)

  // 플레이어 복귀(마지막 플레이어 경로 저장해 둔 값 사용)
  const openPlayer = () => {
    const last =
      (typeof window !== "undefined" && sessionStorage.getItem("lastPlayerRoute")) ||
      "/recommend"
    router.push(last)
  }

  // useSearchParams 대신 클라이언트에서만 쿼리 읽기
  useEffect(() => {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)

    if (url.searchParams.get("from") === "player") {
      setShowNav(true)
      url.searchParams.delete("from")
      window.history.replaceState({}, "", url.toString())
    } else {
      setShowNav(false)
    }

    // 연동 리다이렉트 흔적이 있으면 강제 재조회
    if (url.searchParams.has("spotify")) {
      invalidateSpotifyStatus()
      url.searchParams.delete("spotify")
      window.history.replaceState({}, "", url.toString())
    }
  }, [])

  // Spotify 연결 상태 체크(60초 캐시 + 포커스시 강제 재조회)
  useEffect(() => {
    let mounted = true

    const checkConnected = async (force = false) => {
      try {
        if (force) invalidateSpotifyStatus()
        const j = await getSpotifyStatus()
        if (!mounted) return
        const connected = !!j?.connected
        setIsSpotifyConnected(connected)

        const dismissedUntil = Number(localStorage.getItem(dismissKey) || "0")
        const now = Date.now()
        setShowSpotifyModal(isLoggedIn ? !connected && now > dismissedUntil : false)
      } catch {
        if (!mounted) return
        setIsSpotifyConnected(false)
        setShowSpotifyModal(isLoggedIn)
      }
    }

    // 최초 1회 강제 재조회
    checkConnected(true)

    const onFocus = () => checkConnected(true)
    window.addEventListener("focus", onFocus)
    return () => {
      mounted = false
      window.removeEventListener("focus", onFocus)
    }
  }, [dismissKey, isLoggedIn])

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    )
  }

  return (
    <>
      <div className={`min-h-screen bg-background ${showNav ? "pb-20" : "pb-6"}`}>
        <Suspense fallback={<div className="h-14" />}>
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
        </Suspense>

        <main className="max-w-lg mx-auto">
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

          <section className="px-4 pb-4">
            <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 rounded-2xl p-6 mb-6">
              <h2 className="text-xl font-bold text-foreground mb-2 text-balance">
                당신의 감정을 음악으로
              </h2>
              <p className="text-sm text-muted-foreground mb-4 text-pretty">
                사진을 업로드하면 AI가 감정을 분석하고
                <br />
                딱 맞는 음악을 추천해드려요
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

        {!showNav && (
          <button
            onClick={() => setShowUploadModal(true)}
            className="fixed bottom-6 right-4 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-40"
            aria-label="사진 업로드"
          >
            <Camera className="w-6 h-6" />
          </button>
        )}
      </div>

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
          window.location.href = `${API_BASE}/api/spotify/authorize?return=/`
        }}
      />

      {/* 추천에서 내려왔을 때만: 미니 플레이어 스타일 하단바 */}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black text-white shadow-[0_-6px_18px_rgba(0,0,0,0.3)]">
          {/* 진행바(디자인용) */}
          <div className="h-[3px] w-full bg-white/10">
            <div className="h-[3px] w-1/3 bg-white/60" />
          </div>

          <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            {/* 왼쪽: 홈 + 현재정보 (클릭시 플레이어 이동) */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => router.push("/")}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="홈"
                title="홈"
              >
                <Home className="w-5 h-5" />
              </button>

              <button
                onClick={openPlayer}
                className="group flex items-center gap-3 min-w-0"
                title="플레이어 열기"
              >
                <div className="w-10 h-10 rounded-sm bg-white/10 overflow-hidden flex-shrink-0" />
                <div className="min-w-0 text-left">
                  <p className="text-sm font-medium truncate">지금 재생 중</p>
                  <p className="text-xs text-white/60 truncate">플레이어에서 자세히 보기</p>
                </div>
              </button>
            </div>

            {/* 가운데: 컨트롤(누르면 플레이어) */}
            <div className="flex items-center gap-5">
              <button
                onClick={openPlayer}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="이전"
                title="이전"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={openPlayer}
                className="w-10 h-10 rounded-full bg-white text-black hover:bg-white/90 flex items-center justify-center"
                aria-label="재생/일시정지"
                title="플레이어 열기"
              >
                <Play className="w-5 h-5 translate-x-[1px]" />
              </button>
              <button
                onClick={openPlayer}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="다음"
                title="다음"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* 오른쪽: 플레이리스트/볼륨(디자인용) */}
            <div className="flex items-center gap-3">
              <button
                onClick={openPlayer}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="재생목록"
                title="재생목록"
              >
                <ListMusic className="w-5 h-5" />
              </button>
              <div className="hidden sm:flex items-center gap-2">
                <Volume2 className="w-5 h-5" />
                <div className="w-24 h-1.5 rounded-full bg-white/15 overflow-hidden">
                  <div className="h-1.5 w-1/2 bg-white/60" />
                </div>
              </div>
            </div>
          </div>
        </nav>
      )}
    </>
  )
}
