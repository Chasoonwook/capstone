"use client"

import type React from "react"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Play, Pause, SkipBack, SkipForward, X, ChevronLeft, ChevronRight } from "lucide-react"
import { API_BASE } from "@/lib/api"

/** ---------- 타입 ---------- */
type Song = {
  id: number | string
  title: string
  artist: string
  genre: string
  duration?: string // "mm:ss"
  image?: string | null
}

type BackendSong = {
  id?: number | string
  music_id?: number | string
  title?: string
  artist?: string
  label?: string
  genre?: string
  genre_code?: string
  duration?: number
  duration_sec?: number
}

type ByPhotoResponse = {
  main_songs?: BackendSong[]
  sub_songs?: BackendSong[]
}

/** ---------- 유틸 ---------- */
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

const isBackendSong = (v: unknown): v is BackendSong => {
  if (!isRecord(v)) return false
  const { id, music_id, title, artist, label, genre, duration, duration_sec } = v
  const isOptStrOrNum = (x: unknown) => typeof x === "string" || typeof x === "number" || typeof x === "undefined"
  const isOptNum = (x: unknown) => typeof x === "number" || typeof x === "undefined"
  return (
    isOptStrOrNum(id) &&
    isOptStrOrNum(music_id) &&
    (typeof title === "string" || typeof title === "undefined") &&
    (typeof artist === "string" || typeof artist === "undefined") &&
    (typeof label === "string" || typeof label === "undefined") &&
    (typeof genre === "string" || typeof genre === "undefined") &&
    isOptNum(duration) &&
    isOptNum(duration_sec)
  )
}

const toBackendSongArray = (v: unknown): BackendSong[] => (Array.isArray(v) ? v.filter(isBackendSong) : [])

async function safeText(res: Response) {
  try {
    return await res.text()
  } catch {
    return ""
  }
}

// 업로드 이미지 바이너리 URL 탐색
async function resolveImageUrl(photoId: string): Promise<string | null> {
  const candidates = [`${API_BASE}/api/photos/${photoId}/binary`, `${API_BASE}/photos/${photoId}/binary`]
  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: "GET" })
      if (r.ok) return url
    } catch {
      /* ignore */
    }
  }
  return null
}

// "mm:ss" -> seconds
function parseDurationToSec(d?: string): number {
  if (!d) return 180
  const m = /^(\d+):(\d{2})$/.exec(d)
  if (!m) return 180
  const mins = Number(m[1])
  const secs = Number(m[2])
  if (Number.isNaN(mins) || Number.isNaN(secs)) return 180
  return mins * 60 + secs
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

/** ---------- 컴포넌트 ---------- */
export default function RecommendClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const photoId = searchParams.get("photoId")

  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [recommendations, setRecommendations] = useState<Song[]>([])
  const [currentSong, setCurrentSong] = useState<Song | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(180)

  const [currentViewIndex, setCurrentViewIndex] = useState(0)

  /** 1) 업로드 이미지 URL */
  useEffect(() => {
    let mounted = true
    ;(async () => {
      if (!photoId) {
        setUploadedImage(null)
        return
      }
      const url = await resolveImageUrl(photoId)
      if (mounted) setUploadedImage(url ?? "/placeholder.svg")
      if (!url) console.warn("[binary] 이미지 바이너리 404: photoId =", photoId)
    })()
    return () => {
      mounted = false
    }
  }, [photoId])

  /** 2) 추천(by-photo) */
  useEffect(() => {
    let mounted = true

    const fetchByPhoto = async () => {
      if (!photoId) return
      try {
        const r = await fetch(`${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}`)
        if (!r.ok) {
          console.error("[by-photo] 실패:", r.status, await safeText(r))
          setRecommendations([])
          setCurrentSong(null)
          return
        }
        const raw: unknown = await r.json()
        const resp: ByPhotoResponse = isRecord(raw)
          ? {
              main_songs: toBackendSongArray((raw as Record<string, unknown>).main_songs),
              sub_songs: toBackendSongArray((raw as Record<string, unknown>).sub_songs),
            }
          : { main_songs: [], sub_songs: [] }

        const list: BackendSong[] = [...(resp.main_songs ?? []), ...(resp.sub_songs ?? [])]

        // dedup by music_id/id
        const seen = new Set<string | number>()
        const dedup: BackendSong[] = []
        list.forEach((s, i) => {
          const id = (s.music_id ?? s.id ?? i) as string | number
          if (!seen.has(id)) {
            seen.add(id)
            dedup.push(s)
          }
        })

        const songs: Song[] = dedup.map((it, idx) => {
          const sec =
            typeof it.duration === "number" ? it.duration : typeof it.duration_sec === "number" ? it.duration_sec : 180
          const mm = Math.floor(sec / 60)
          const ss = String(sec % 60).padStart(2, "0")
          return {
            id: it.music_id ?? it.id ?? idx,
            title: it.title ?? "Unknown Title",
            artist: it.artist ?? "Unknown Artist",
            genre: it.genre ?? it.label ?? "UNKNOWN",
            duration: `${mm}:${ss}`,
            image: uploadedImage ?? "/placeholder.svg",
          }
        })

        if (mounted) {
          setRecommendations(songs)
          const first = songs[0] ?? null
          setCurrentSong(first)
          setCurrentTime(0)
          setIsPlaying(false)
          setDuration(parseDurationToSec(first?.duration))
        }
      } catch (e) {
        console.error("추천 불러오기 오류:", e)
        setRecommendations([])
        setCurrentSong(null)
      }
    }

    fetchByPhoto()
    return () => {
      mounted = false
    }
  }, [photoId, uploadedImage])

  /** 3) 타이머 */
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => {
      setCurrentTime((t) => (t + 1 > duration ? duration : t + 1))
    }, 1000)
    return () => clearInterval(id)
  }, [isPlaying, duration])

  /** 4) 컨트롤 */
  const togglePlay = () => setIsPlaying((p) => !p)

  const playNextSong = () => {
    if (!currentSong || recommendations.length === 0) return
    const currentIndex = recommendations.findIndex((song) => song.id === currentSong.id)
    const nextIndex = (currentIndex + 1) % recommendations.length
    const next = recommendations[nextIndex]
    setCurrentSong(next)
    setCurrentTime(0)
    setDuration(parseDurationToSec(next.duration))
    setIsPlaying(true)
  }

  const playPreviousSong = () => {
    if (!currentSong || recommendations.length === 0) return
    const currentIndex = recommendations.findIndex((song) => song.id === currentSong.id)
    const prevIndex = currentIndex === 0 ? recommendations.length - 1 : currentIndex - 1
    const prev = recommendations[prevIndex]
    setCurrentSong(prev)
    setCurrentTime(0)
    setDuration(parseDurationToSec(prev.duration))
    setIsPlaying(true)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    if (Number.isFinite(val)) setCurrentTime(Math.min(Math.max(val, 0), duration))
  }

  /** 5) 배경 이미지 */
  const safeImageSrc = useMemo(() => uploadedImage || "/placeholder.svg", [uploadedImage])
  const safeBgStyle = useMemo(() => ({ backgroundImage: `url(${safeImageSrc})` }), [safeImageSrc])

  /** ---------- 뷰들 ---------- */
  const CDPlayerView = () => (
    <div className="flex items-center justify-between w-full h-full px-8">
      {/* CD Player - Left Side */}
      <div className="flex items-center justify-center">
        <div className="relative">
          <div className={`relative w-64 h-64 ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "4s" }}>
            <div className="w-full h-full rounded-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 shadow-2xl border-4 border-slate-300 relative">
              <div
                className="w-full h-full rounded-full overflow-hidden border-8 border-slate-800 relative z-10 bg-center bg-cover"
                style={{ backgroundImage: `url(${currentSong?.image ?? safeImageSrc})` }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-slate-900/90 rounded-full shadow-inner flex items-center justify-center">
                  <div className="w-6 h-6 bg-slate-950 rounded-full"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Song Info & Controls - Center */}
      <div className="flex flex-col items-center justify-center flex-1 max-w-md mx-8">
        {/* Album Cover */}
        <div
          className="w-20 h-20 rounded-lg overflow-hidden mb-4 bg-center bg-cover border border-white/20"
          style={{ backgroundImage: `url(${currentSong?.image ?? safeImageSrc})` }}
        />

        {/* Song Info */}
        <div className="text-center mb-4">
          <h3 className="text-white text-2xl font-semibold mb-1">{currentSong?.title ?? "—"}</h3>
          <p className="text-slate-300 text-lg mb-2">{currentSong?.artist ?? "—"}</p>
          {currentSong?.genre && (
            <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 px-4 py-1">
              {currentSong.genre}
            </Badge>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-full mb-4">
          <div className="flex justify-between text-slate-300 text-sm mb-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            onChange={handleSeek}
            className="w-full accent-purple-500"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-4">
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full bg-white/10 hover:bg-white/20 w-12 h-12"
            onClick={playPreviousSong}
            aria-label="previous"
          >
            <SkipBack className="h-5 w-5 text-white" />
          </Button>

          <Button
            size="icon"
            className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 w-14 h-14"
            onClick={togglePlay}
            aria-label={isPlaying ? "pause" : "play"}
          >
            {isPlaying ? <Pause className="h-6 w-6 text-white" /> : <Play className="h-6 w-6 text-white" />}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="rounded-full bg-white/10 hover:bg-white/20 w-12 h-12"
            onClick={playNextSong}
            aria-label="next"
          >
            <SkipForward className="h-5 w-5 text-white" />
          </Button>
        </div>
      </div>

      {/* Playlist - Right Side */}
      <div className="w-80 h-full bg-black/30 backdrop-blur-sm rounded-2xl p-4 flex flex-col">
        <h2 className="text-white font-bold text-xl mb-4 text-center">추천 음악</h2>
        <div className="overflow-y-auto flex-1 space-y-2">
          {recommendations.length > 0 ? (
            recommendations.map((song) => (
              <div
                key={song.id}
                onClick={() => {
                  setCurrentSong(song)
                  setCurrentTime(0)
                  setDuration(parseDurationToSec(song.duration))
                  setIsPlaying(true)
                }}
                className={`flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-white/10 ${
                  currentSong?.id === song.id
                    ? "bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-400/50"
                    : ""
                }`}
              >
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden mr-3 border border-white/10 bg-center bg-cover"
                  style={{ backgroundImage: `url(${song.image ?? safeImageSrc})` }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate text-sm">{song.title}</p>
                  <p className="text-slate-300 text-xs truncate">{song.artist}</p>
                </div>
                <div className="flex-shrink-0 ml-2 text-right">
                  <Badge variant="secondary" className="bg-white/10 text-slate-300 text-xs px-2 py-0.5 border-0 mb-1">
                    {song.genre}
                  </Badge>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-400 mt-10">추천 음악이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  )

  const InstagramView = () => (
    <div className="flex-1 flex items-center justify-center w-full h-full">
      <div className="text-slate-300">Instagram View (준비 중)</div>
    </div>
  )

  const DefaultView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="text-slate-300">Default View (준비 중)</div>
    </div>
  )

  const renderCurrentView = () => {
    const views = ["cd", "instagram", "default"] as const
    switch (views[currentViewIndex]) {
      case "cd":
        return <CDPlayerView />
      case "instagram":
        return <InstagramView />
      default:
        return <DefaultView />
    }
  }

  /** 네비게이션/뷰 전환 */
  const handleClose = () => {
    try {
      router.replace("/")
    } catch {
      ;(window as unknown as { location: Location }).location.href = "/"
    }
  }

  const handlePrevView = () => setCurrentViewIndex((prev) => (prev - 1 + 3) % 3)
  const handleNextView = () => setCurrentViewIndex((prev) => (prev + 1) % 3)

  return (
    <div className="fixed inset-0 z-40 bg-black bg-opacity-95 flex items-center justify-center">
      {/* 배경 */}
      <div className="absolute inset-0 bg-cover bg-center blur-md scale-110" style={safeBgStyle} />
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black/50 to-pink-900/30"></div>

      {/* 닫기 */}
      <div className="absolute top-6 right-6 z-50">
        <button
          onClick={handleClose}
          className="bg-white/10 backdrop-blur-sm rounded-full p-3 shadow-lg hover:bg-white/20 transition-all duration-200 hover:scale-110 border border-white/20"
          type="button"
        >
          <X className="h-6 w-6 text-white" />
        </button>
      </div>

      {/* 좌/우 뷰 전환 */}
      <button
        onClick={handlePrevView}
        className="absolute left-6 top-1/2 -translate-y-1/2 z-40 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
        type="button"
      >
        <ChevronLeft className="h-6 w-6 text-white" />
      </button>
      <button
        onClick={handleNextView}
        className="absolute right-6 top-1/2 -translate-y-1/2 z-40 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
        type="button"
      >
        <ChevronRight className="h-6 w-6 text-white" />
      </button>

      {/* 메인 View */}
      <div className="relative z-30 w-full h-full flex items-center justify-center px-20">{renderCurrentView()}</div>
    </div>
  )
}
