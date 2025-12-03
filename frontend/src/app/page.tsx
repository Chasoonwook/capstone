"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import PhotoUpload from "@/components/upload/PhotoUpload"
import { useAuthUser } from "@/hooks/useAuthUser"
import { useMusics } from "@/hooks/useMusics"
import { useHistory } from "@/hooks/useHistory"
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal"
import Header from "@/components/header/Header"
import HistorySwitch from "@/components/history/HistorySwitch"
import { Camera, Home, SkipBack, Play, SkipForward, ListMusic, Volume2, Sparkles } from "lucide-react"
import { API_BASE } from "@/lib/api"
import { useSpotifyStatus } from "../contexts/SpotifyStatusContext"
import GyroShine from "@/components/ui/GyroShine"

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
      anyUser.id?.toString()?.trim() ||
      anyUser.uid?.toString()?.trim() ||
      anyUser.userId?.toString()?.trim() ||
      "guest"
    )
  }, [user])

  const seenKey = useMemo(() => `spotify_connect_prompt_seen::${accountId}`, [accountId])

  const { status } = useSpotifyStatus()
  const isSpotifyConnected = !!status?.connected
  const [showSpotifyModal, setShowSpotifyModal] = useState(false)
  const [showNav, setShowNav] = useState(false)
  const [isPageLoaded, setIsPageLoaded] = useState(false)

  const openPlayer = () => {
    const last = (typeof window !== "undefined" && sessionStorage.getItem("lastPlayerRoute")) || "/recommend"
    router.push(last)
  }

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

    const alreadySeen = localStorage.getItem(seenKey) === "1"
    setShowSpotifyModal(isLoggedIn && !isSpotifyConnected && !alreadySeen)

    setTimeout(() => setIsPageLoaded(true), 100)
  }, [])

  useEffect(() => {
    if (isSpotifyConnected) {
      setShowSpotifyModal(false)
      try {
        localStorage.setItem(seenKey, "1")
      } catch {}
    }
  }, [isSpotifyConnected, seenKey])

  return (
    <>
      <div
        className={`min-h-screen bg-background transition-all duration-500 ${showNav ? "pb-24 md:pb-28" : "pb-6"} relative overflow-hidden`}
      >
        <div className="fixed inset-0 -z-10 opacity-20 dark:opacity-10">
          <div
            className="absolute top-1/4 left-1/3 w-72 h-72 bg-purple-400/30 rounded-full blur-[100px] animate-pulse"
            style={{ animationDuration: "5s" }}
          />
          <div
            className="absolute top-1/2 right-1/3 w-64 h-64 bg-pink-400/25 rounded-full blur-[90px] animate-pulse"
            style={{ animationDuration: "7s", animationDelay: "1.5s" }}
          />
          <div
            className="absolute bottom-1/4 left-1/2 w-80 h-80 bg-blue-400/20 rounded-full blur-[110px] animate-pulse"
            style={{ animationDuration: "6s", animationDelay: "0.8s" }}
          />

          <div
            className="absolute top-[15%] left-[8%] w-12 h-12 md:w-16 md:h-16 opacity-40 animate-bounce"
            style={{ animationDuration: "3s" }}
          >
            <img src="/pink-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div
            className="absolute top-[25%] right-[8%] w-10 h-10 md:w-14 md:h-14 opacity-35 animate-bounce"
            style={{ animationDuration: "3.5s", animationDelay: "0.5s" }}
          >
            <img src="/blue-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div
            className="absolute top-[45%] left-[15%] w-8 h-8 md:w-12 md:h-12 opacity-30 animate-bounce"
            style={{ animationDuration: "4s", animationDelay: "1s" }}
          >
            <img src="/purple-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div
            className="absolute top-[60%] right-[20%] w-14 h-14 md:w-18 md:h-18 opacity-35 animate-bounce"
            style={{ animationDuration: "3.2s", animationDelay: "1.5s" }}
          >
            <img src="/yellow-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div
            className="absolute bottom-[20%] left-[25%] w-10 h-10 md:w-14 md:h-14 opacity-40 animate-bounce"
            style={{ animationDuration: "3.8s", animationDelay: "0.8s" }}
          >
            <img src="/green-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div
            className="absolute bottom-[35%] right-[10%] w-12 h-12 md:w-16 md:h-16 opacity-30 animate-bounce"
            style={{ animationDuration: "4.2s", animationDelay: "2s" }}
          >
            <img src="/red-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div
            className="absolute top-[70%] left-[40%] w-8 h-8 md:w-12 md:h-12 opacity-35 animate-bounce"
            style={{ animationDuration: "3.6s", animationDelay: "1.2s" }}
          >
            <img src="/orange-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div
            className="absolute top-[35%] right-[35%] w-10 h-10 md:w-14 md:h-14 opacity-25 animate-bounce"
            style={{ animationDuration: "4.5s", animationDelay: "0.3s" }}
          >
            <img src="/cyan-music-note.png" alt="" className="w-full h-full object-contain" />
          </div>
        </div>

        <Suspense fallback={<div className="h-16 md:h-20" />}>
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

        <main
          className={`w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-700 ${isPageLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
        >
          <div className="pt-4 md:pt-6">
            <Suspense fallback={<div className="text-sm text-muted-foreground animate-pulse">Loading history...</div>}>
              <HistorySwitch user={user} history={history} loading={historyLoading} error={historyError} />
            </Suspense>
          </div>

          <section className="py-6 md:py-8 lg:py-10">
            <div className="max-w-3xl mx-auto transition-all duration-700 delay-100">
              <div className="group relative overflow-hidden bg-white/90 rounded-2xl md:rounded-3xl p-6 md:p-8 lg:p-10 border border-border/40 shadow-lg hover:shadow-xl transition-all duration-500 hover:scale-[1.01]">
                <div
                  className="absolute top-4 right-6 w-48 h-48 bg-gradient-to-br from-pink-300/20 to-purple-300/20 dark:from-pink-400/10 dark:to-purple-400/10 rounded-full blur-2xl animate-pulse"
                  style={{ animationDuration: "4s" }}
                />
                <div
                  className="absolute bottom-4 left-6 w-40 h-40 bg-gradient-to-tr from-blue-300/20 to-cyan-300/20 dark:from-blue-400/10 dark:to-cyan-400/10 rounded-full blur-2xl animate-pulse"
                  style={{ animationDuration: "5s", animationDelay: "1s" }}
                />

                <div className="absolute inset-0 opacity-50 dark:opacity-40 pointer-events-none overflow-hidden">
                  <div
                    className="absolute top-[8%] right-[15%] w-10 h-10 md:w-12 md:h-12 animate-bounce"
                    style={{ animationDuration: "2.5s" }}
                  >
                    <img
                      src="/pink-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                  <div
                    className="absolute top-[20%] left-[12%] w-8 h-8 md:w-10 md:h-10 animate-bounce"
                    style={{ animationDuration: "3.2s", animationDelay: "0.5s" }}
                  >
                    <img
                      src="/purple-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                  <div
                    className="absolute bottom-[18%] right-[15%] w-9 h-9 md:w-11 md:h-11 animate-bounce"
                    style={{ animationDuration: "2.8s", animationDelay: "1.2s" }}
                  >
                    <img
                      src="/blue-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                  <div
                    className="absolute bottom-[25%] left-[10%] w-7 h-7 md:w-9 md:h-9 animate-bounce"
                    style={{ animationDuration: "3.5s", animationDelay: "0.8s" }}
                  >
                    <img
                      src="/yellow-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                  <div
                    className="absolute top-[40%] right-[8%] w-8 h-8 md:w-10 md:h-10 animate-bounce"
                    style={{ animationDuration: "3s", animationDelay: "1.5s" }}
                  >
                    <img
                      src="/cyan-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                  <div
                    className="absolute top-[55%] left-[18%] w-10 h-10 md:w-12 md:h-12 animate-bounce"
                    style={{ animationDuration: "3.3s", animationDelay: "0.3s" }}
                  >
                    <img
                      src="/green-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                  <div
                    className="absolute bottom-[40%] right-[18%] w-7 h-7 md:w-9 md:h-9 animate-bounce"
                    style={{ animationDuration: "3.7s", animationDelay: "1.8s" }}
                  >
                    <img
                      src="/orange-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                  <div
                    className="absolute top-[30%] left-[35%] w-6 h-6 md:w-8 md:h-8 animate-bounce"
                    style={{ animationDuration: "2.9s", animationDelay: "2.2s" }}
                  >
                    <img
                      src="/red-music-note.png"
                      alt=""
                      className="w-full h-full object-contain transform hover:rotate-12 transition-transform"
                    />
                  </div>
                </div>

                <div className="relative z-10 text-center">
                  <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-4 md:mb-6 text-balance leading-tight py-6 md:py-8 lg:py-10">
                    Turn your mood into music
                  </h1>

                  <p className="text-sm md:text-base text-muted-foreground mb-10 md:mb-12 text-pretty leading-relaxed max-w-xl mx-auto">
                    Upload a photo and let AI analyze your mood to recommend the perfect soundtrack for your moment.
                  </p>

                  <div className="flex justify-center">
                    <GyroShine
                      className="rounded-xl md:rounded-2xl"
                      intensity={0.7}
                      radius={280}
                      smooth={0.25}
                      mouseFallback
                    >
                      <button
                        onClick={() => setShowUploadModal(true)}
                        className="relative z-[-10] bg-transparent text-white rounded-xl md:rounded-2xl py-7 md:py-9 px-10 md:px-12 font-bold text-sm md:text-base flex items-center justify-center gap-2.5 md:gap-3 select-none transition-all duration-300 hover:scale-110 active:scale-95 hover:gap-4 group/button shadow-xl hover:shadow-2xl"
                        style={{ textShadow: "0 2px 4px rgba(0,0,0,.5)" }}
                      >
                        <Camera className="w-5 h-5 md:w-6 md:h-6 transition-all duration-300 group-hover/button:rotate-[20deg] group-hover/button:scale-125" />
                        <span className="relative">
                          Analyze mood from photo
                          <span className="absolute -bottom-0.5 left-0 w-0 h-0.5 bg-white/70 transition-all duration-300 group-hover/button:w-full rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                        </span>
                        <Sparkles className="w-4 h-4 md:w-5 md:h-5 opacity-0 -translate-x-2 transition-all duration-300 group-hover/button:opacity-100 group-hover/button:translate-x-0" />
                      </button>
                    </GyroShine>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>

        {!showNav && (
          <button
            onClick={() => setShowUploadModal(true)}
            className="fixed bottom-6 right-4 md:bottom-8 md:right-8 w-14 h-14 md:w-16 md:h-16 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-full shadow-xl hover:shadow-2xl flex items-center justify-center hover:scale-110 active:scale-90 transition-all duration-300 z-40 group animate-bounce-slow hover:rotate-12"
            aria-label="Upload photo to analyze mood"
            style={{ animationDuration: "3s" }}
          >
            <Camera className="w-6 h-6 md:w-7 md:h-7 group-hover:rotate-12 group-hover:scale-110 transition-transform duration-300" />
            <span
              className="absolute inset-0 rounded-full bg-primary/50 animate-ping opacity-75"
              style={{ animationDuration: "2.5s" }}
            />
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent rounded-full border-2 border-background animate-pulse flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </span>
          </button>
        )}
      </div>

      {showUploadModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowUploadModal(false)
          }}
        >
          <div className="bg-background w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl sm:rounded-2xl md:rounded-3xl rounded-t-3xl p-6 md:p-8 lg:p-10 animate-in slide-in-from-bottom sm:slide-in-from-bottom-4 sm:zoom-in-95 duration-300 shadow-2xl max-h-[90vh] overflow-y-auto border border-border/50">
            <div className="flex items-center justify-between mb-6 md:mb-8">
              <div className="flex-1">
                <h3 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground flex items-center gap-3">
                  <Camera className="w-6 h-6 md:w-7 md:h-7 text-primary animate-pulse" />
                  Analyze Mood
                </h3>
                <p className="text-sm md:text-base text-muted-foreground mt-2">
                  Upload a photo to get personalized music recommendations
                </p>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="w-10 h-10 md:w-12 md:h-12 rounded-full hover:bg-muted flex items-center justify-center transition-all duration-200 hover:rotate-90 hover:scale-110 group flex-shrink-0 ml-4"
                aria-label="Close modal"
              >
                <span className="text-xl md:text-2xl text-muted-foreground group-hover:text-foreground transition-colors">
                  ✕
                </span>
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
            localStorage.setItem(seenKey, "1")
          } catch {}
          setShowSpotifyModal(false)
        }}
        onConnect={() => {
          try {
            localStorage.setItem(seenKey, "1")
          } catch {}
          window.location.href = `${API_BASE}/api/spotify/authorize?return=/`
        }}
      />

      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/95 backdrop-blur-xl text-white shadow-[0_-8px_32px_rgba(0,0,0,0.5)] animate-in slide-in-from-bottom duration-500">
          <div className="h-1 w-full bg-white/10 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            <div className="h-1 w-1/3 bg-white/70 transition-all duration-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 md:py-4">
            <div className="flex md:hidden items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                  onClick={() => router.push("/")}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all duration-200 active:scale-95 hover:scale-110"
                  aria-label="Home"
                >
                  <Home className="w-5 h-5" />
                </button>
                <button onClick={openPlayer} className="flex items-center gap-3 min-w-0 flex-1 group">
                  <div className="w-11 h-11 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden relative">
                    <div
                      className="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20 animate-pulse"
                      style={{ animationDuration: "2s" }}
                    />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      Now Playing
                    </p>
                    <p className="text-xs text-white/60 truncate">Tap to open</p>
                  </div>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={openPlayer}
                  className="w-10 h-10 rounded-full bg-white text-black hover:bg-white/90 flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95"
                  aria-label="Play/Pause"
                >
                  <Play className="w-5 h-5 translate-x-[1px]" />
                </button>
              </div>
            </div>

            <div className="hidden md:flex items-center justify-between gap-6">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <button
                  onClick={() => router.push("/")}
                  className="p-2.5 rounded-lg hover:bg-white/10 transition-all duration-200 active:scale-95 hover:scale-110"
                  aria-label="Home"
                >
                  <Home className="w-5 h-5" />
                </button>
                <button onClick={openPlayer} className="flex items-center gap-4 min-w-0 group">
                  <div className="w-12 h-12 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden relative">
                    <div
                      className="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20 animate-pulse"
                      style={{ animationDuration: "2s" }}
                    />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-base font-semibold truncate group-hover:text-primary transition-colors">
                      Now Playing
                    </p>
                    <p className="text-sm text-white/70 truncate">Click to open player</p>
                  </div>
                </button>
              </div>

              <div className="flex items-center gap-4 lg:gap-6">
                <button
                  onClick={openPlayer}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
                  aria-label="Previous track"
                >
                  <SkipBack className="w-5 h-5" />
                </button>
                <button
                  onClick={openPlayer}
                  className="w-11 h-11 rounded-full bg-white text-black hover:bg-white/90 flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg"
                  aria-label="Play/Pause"
                >
                  <Play className="w-5 h-5 translate-x-[1px]" />
                </button>
                <button
                  onClick={openPlayer}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
                  aria-label="Next track"
                >
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-4 justify-end flex-1">
                <button
                  onClick={openPlayer}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
                  aria-label="Queue"
                >
                  <ListMusic className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3">
                  <Volume2 className="w-5 h-5" />
                  <div className="w-24 lg:w-32 h-1.5 rounded-full bg-white/15 overflow-hidden relative group cursor-pointer">
                    <div className="h-1.5 w-1/2 bg-white/70 transition-all duration-150 group-hover:bg-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </nav>
      )}
    </>
  )
}
