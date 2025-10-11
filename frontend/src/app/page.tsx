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

import { Camera, Home, Music2 } from "lucide-react"
import { API_BASE } from "@/lib/api"
import { getSpotifyStatus } from "../lib/spotifyClient";

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
      (typeof window !== "undefined" &&
        sessionStorage.getItem("lastPlayerRoute")) ||
      "/recommend"
    router.push(last)
  }

  // useSearchParams 없이, 클라이언트에서만 쿼리 확인 (CSR-bailout 경고 방지)
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
  }, [])

  // Spotify 연결 상태 체크(60초 캐시 + 포커스시 재확인)
  useEffect(() => {
    let mounted = true

    const checkConnected = async () => {
      try {
        const j = await getSpotifyStatus() // ★ 중앙 유틸 사용(클라이언트 전용)
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

    checkConnected()
    window.addEventListener("focus", checkConnected)
    return () => {
      mounted = false
      window.removeEventListener("focus", checkConnected)
    }
  }, [dismissKey, isLoggedIn])

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    )
  }

  return (
    <>
      <div className={`min-h-screen bg-background ${showNav ? "pb-24" : "pb-6"}`}>
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

      {/* 추천에서 내려왔을 때만 하단 내비 */}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 z-40">
          <div className="max-w-lg mx-auto flex items-center justify-between px-6 py-3">
            <button
              onClick={() => router.push("/")}
              className="w-10 h-10 rounded-full hover:bg-muted/60 flex items-center justify-center text-foreground"
              aria-label="홈"
              title="홈"
            >
              <Home className="w-6 h-6" />
            </button>

            <button
              onClick={openPlayer}
              className="w-14 h-14 -translate-y-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
              aria-label="플레이어 열기"
              title="플레이어 열기"
            >
              <Music2 className="w-6 h-6" />
            </button>

            <button
              onClick={() => setShowUploadModal(true)}
              className="w-10 h-10 rounded-full hover:bg-muted/60 flex items-center justify-center text-foreground"
              aria-label="사진 업로드"
              title="사진 업로드"
            >
              <Camera className="w-6 h-6" />
            </button>
          </div>
        </nav>
      )}
    </>
  )
}
