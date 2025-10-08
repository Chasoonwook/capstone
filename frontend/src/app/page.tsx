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
import { Camera } from "lucide-react"
import { API_BASE } from "@/lib/api"

export default function Page() {
  const { user, isLoggedIn, logout } = useAuthUser()
  const router = useRouter()
  const { musics, loading: musicsLoading, error: musicsError } = useMusics()
  const { history, loading: historyLoading, error: historyError } = useHistory(isLoggedIn)
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)

  const accountId = useMemo(() => {
    const anyUser = (user ?? {}) as any;
    return anyUser.email?.trim() || anyUser.id?.trim() || anyUser.uid?.trim() || anyUser.userId?.trim() || "guest";
  }, [user])

  const dismissKey = useMemo(() => `spotify_connect_modal_dismissed_until::${accountId}`, [accountId])

  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false)
  const [showSpotifyModal, setShowSpotifyModal] = useState(false)

  // ✅ [수정] 스포티파이 연결 상태 확인 로직
  useEffect(() => {
    let mounted = true;
    const checkConnected = () => {
      try {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          if (url.searchParams.get("spotify") === "connected") {
            url.searchParams.delete("spotify");
            window.history.replaceState({}, "", url.toString());
          }
        }
        
        const expiresAt = Number(localStorage.getItem("spotify_token_expires_at") || "0");
        const accessToken = localStorage.getItem("spotify_access_token");
        const connected = !!accessToken && Date.now() < expiresAt;
        
        if (!mounted) return;
        setIsSpotifyConnected(connected);

        const dismissedUntil = Number(localStorage.getItem(dismissKey) || "0");
        const now = Date.now();
        setShowSpotifyModal(isLoggedIn ? !connected && now > dismissedUntil : false);
      } catch {
        if (!mounted) return;
        setIsSpotifyConnected(false);
        setShowSpotifyModal(isLoggedIn);
      }
    };

    checkConnected();
    window.addEventListener('focus', checkConnected);
    return () => {
      mounted = false;
      window.removeEventListener('focus', checkConnected);
    };
  }, [dismissKey, isLoggedIn]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
  }

  return (
    <>
      <div className="min-h-screen bg-background pb-6">
        <Suspense fallback={<div className="h-14" />}>
          <Header user={user} isLoggedIn={isLoggedIn} onLogout={() => { logout(); router.push("/login"); }} musics={musics} loading={musicsLoading} error={musicsError} />
        </Suspense>
        <main className="max-w-lg mx-auto">
          <div className="pt-4">
            <Suspense fallback={<div className="px-4 text-sm text-muted-foreground">로딩 중…</div>}>
              <HistorySwitch user={user} history={history} loading={historyLoading} error={historyError} />
            </Suspense>
          </div>
          <section className="px-4 pb-4">
            <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 rounded-2xl p-6 mb-6">
              <h2 className="text-xl font-bold text-foreground mb-2 text-balance">당신의 감정을 음악으로</h2>
              <p className="text-sm text-muted-foreground mb-4 text-pretty">사진을 업로드하면 AI가 감정을 분석하고<br />딱 맞는 음악을 추천해드려요</p>
              <button onClick={() => setShowUploadModal(true)} className="w-full bg-primary text-primary-foreground rounded-lg py-3 px-4 font-medium text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors">
                <Camera className="w-4 h-4" /> 사진으로 감정 분석하기
              </button>
            </div>
          </section>
          <section className="px-4 mb-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">지금 기분은?</h2>
            <MoodBadges selected={selectedGenres} onToggle={toggleGenre} />
          </section>
        </main>
        <button onClick={() => setShowUploadModal(true)} className="fixed bottom-6 right-4 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-40" aria-label="사진 업로드">
          <Camera className="w-6 h-6" />
        </button>
      </div>
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl p-6 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">감정 분석하기</h3>
              <button onClick={() => setShowUploadModal(false)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">✕</button>
            </div>
            <PhotoUpload isLoggedIn={isLoggedIn} selectedGenres={selectedGenres} onRequireLogin={() => { setShowUploadModal(false); router.push("/login"); }} />
          </div>
        </div>
      )}
      <SpotifyConnectModal open={isLoggedIn && !isSpotifyConnected && showSpotifyModal} onClose={() => {
        try { const sevenDaysMs = 7 * 24 * 60 * 60 * 1000; const expireAt = Date.now() + sevenDaysMs; localStorage.setItem(dismissKey, String(expireAt)); } catch {}
        setShowSpotifyModal(false);
      }} onConnect={() => { window.location.href = `${API_BASE}/api/spotify/authorize?return=/`; }} />
    </>
  )
}