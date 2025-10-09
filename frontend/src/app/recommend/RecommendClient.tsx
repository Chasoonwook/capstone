"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronDown,
  MoreVertical,
  Heart,
  ThumbsDown,
  ListMusic,
  Upload, // ⬅ 업로드 아이콘
} from "lucide-react"
import { cn } from "@/lib/utils"
import { API_BASE } from "@/lib/api"

type Track = {
  id: number
  title: string
  artist: string
  album?: string
  coverUrl?: string
  audioUrl: string
  duration?: number
}

const demoPlaylist: Track[] = [
  {
    id: 1,
    title: "TOO BAD",
    artist: "G-DRAGON, Anderson.Paak",
    audioUrl: "/audio/track1.mp3",
    duration: 153,
    coverUrl: "/album-cover.png",
  },
  {
    id: 2,
    title: "Electric Pulse",
    artist: "Neon Waves",
    audioUrl: "/audio/track2.mp3",
    duration: 198,
    coverUrl: "/abstract-music-album-cover-electric-purple.jpg",
  },
  {
    id: 3,
    title: "Golden Hour",
    artist: "Sunset Boulevard",
    audioUrl: "/audio/track3.mp3",
    duration: 223,
    coverUrl: "/abstract-music-album-cover-golden-sunset.jpg",
  },
]

// 추천에 사용된 사진(built from photoId)
const buildPhotoSrc = (photoId?: string | null) => {
  if (!photoId) return null
  const id = encodeURIComponent(String(photoId))
  return `${API_BASE}/api/photos/${id}/binary`
}

export default function RecommendClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const photoId = searchParams.get("photoId") || searchParams.get("photoID") || searchParams.get("id")
  const analyzedPhotoUrl = useMemo(() => buildPhotoSrc(photoId), [photoId])

  // 사용자 이름: 프로젝트 훅이 있으면 대체(useAuthUser 등)
  const userNameFallback =
    typeof window !== "undefined" ? localStorage.getItem("user_name") || localStorage.getItem("name") : null
  const playlistTitle = `${(userNameFallback || "내")} 플레이리스트`

  const [playlist] = useState<Track[]>(demoPlaylist)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number>(demoPlaylist[0]?.duration ?? 0)
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [likedTracks, setLikedTracks] = useState<Set<number>>(new Set())
  const [dislikedTracks, setDislikedTracks] = useState<Set<number>>(new Set())

  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null) // ⬅ 업로드 트리거
  const currentTrack = playlist[currentTrackIndex]

  // 트랙 로드
  const loadCurrentTrack = useCallback(
    async (autoplay = false) => {
      const audio = audioRef.current
      if (!audio) return
      setCurrentTime(0)
      audio.src = currentTrack.audioUrl
      audio.load()

      const onLoaded = () => {
        const d = Math.floor(audio.duration || 0)
        setDuration(currentTrack.duration ?? d)
      }
      audio.addEventListener("loadedmetadata", onLoaded, { once: true })

      if (autoplay) {
        try {
          await audio.play()
          setIsPlaying(true)
        } catch {
          setIsPlaying(false)
        }
      }
    },
    [currentTrack],
  )

  useEffect(() => {
    void loadCurrentTrack(isPlaying)
  }, [currentTrackIndex, loadCurrentTrack]) // eslint-disable-line react-hooks/exhaustive-deps

  // 진행/종료
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setCurrentTime(audio.currentTime)
    const onEnded = () => handleNext()
    audio.addEventListener("timeupdate", onTime)
    audio.addEventListener("ended", onEnded)
    return () => {
      audio.removeEventListener("timeupdate", onTime)
      audio.removeEventListener("ended", onEnded)
    }
  }, []) // 반복 기능 제거

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      try {
        await audio.play()
        setIsPlaying(true)
      } catch {
        setIsPlaying(false)
      }
    }
  }

  const handlePrevious = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.currentTime > 3) {
      audio.currentTime = 0
      setCurrentTime(0)
      return
    }
    setCurrentTrackIndex((prev) => (prev === 0 ? playlist.length - 1 : prev - 1))
  }

  const handleNext = () => {
    if (currentTrackIndex < playlist.length - 1) setCurrentTrackIndex(currentTrackIndex + 1)
    else setIsPlaying(false)
  }

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current
    if (!audio) return
    const v = Math.min(Math.max(value[0], 0), duration || 0)
    audio.currentTime = v
    setCurrentTime(v)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const t = Math.floor(s % 60)
    return `${m}:${t.toString().padStart(2, "0")}`
  }
  const formatRemain = (s: number) => {
    const r = Math.max((duration || 0) - s, 0)
    const m = Math.floor(r / 60)
    const t = Math.floor(r % 60)
    return `-${m}:${t.toString().padStart(2, "0")}`
  }

  const toggleLike = () => {
    const next = new Set(likedTracks)
    if (next.has(currentTrack.id)) next.delete(currentTrack.id)
    else {
      next.add(currentTrack.id)
      if (dislikedTracks.has(currentTrack.id)) {
        const d = new Set(dislikedTracks)
        d.delete(currentTrack.id)
        setDislikedTracks(d)
      }
    }
    setLikedTracks(next)
  }

  const toggleDislike = () => {
    const next = new Set(dislikedTracks)
    if (next.has(currentTrack.id)) next.delete(currentTrack.id)
    else {
      next.add(currentTrack.id)
      if (likedTracks.has(currentTrack.id)) {
        const l = new Set(likedTracks)
        l.delete(currentTrack.id)
        setLikedTracks(l)
      }
    }
    setDislikedTracks(next)
  }

  const selectTrack = (index: number) => {
    setCurrentTrackIndex(index)
    setShowPlaylist(false)
  }

  // 업로드 클릭 → 파일선택
  const handleUploadClick = () => fileInputRef.current?.click()
  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // TODO: 여기서 업로드/분석 로직 연결
    console.log("selected file:", file)
  }

  // 아트워크(분석 이미지 우선)
  const artUrl = analyzedPhotoUrl || currentTrack.coverUrl || "/placeholder.svg"

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-neutral-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        {/* 헤더: 좌측 뒤로가기, 중앙 타이틀, 우측 더보기 */}
        <div className="relative flex items-center mb-6 text-white">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={() => router.push("/")} // ⬅ 메인으로 이동
            title="메인으로"
          >
            <ChevronDown className="w-6 h-6" />
          </Button>

          {/* 중앙 타이틀 */}
          <div className="absolute left-1/2 -translate-x-1/2">
            <p className="text-sm font-medium text-center">{playlistTitle}</p>
          </div>

          {/* 우측 더보기만 유지 (리스트 버튼은 하단으로 이동) */}
          <div className="ml-auto">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
              <MoreVertical className="w-6 h-6" />
            </Button>
          </div>
        </div>

        {/* 아트워크 */}
        <div className="mb-8">
          <div
            className="relative w-full aspect-square rounded-lg overflow-hidden shadow-2xl mb-6 bg-neutral-800"
            onClick={() => setShowPlaylist(true)}
            role="button"
            aria-label="재생목록 열기"
          >
            <img src={artUrl} alt="analyzed" className="w-full h-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
          </div>

          {/* 곡 정보 */}
          <div className="flex items-start justify-between text-white mb-6">
            <div className="flex-1">
              <h1 className="text-2xl font-bold mb-1">{currentTrack.title}</h1>
              <p className="text-base text-white/70">{currentTrack.artist}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleLike}
                className={cn("text-white hover:bg-white/10", likedTracks.has(currentTrack.id) && "text-red-500")}
                title="좋아요"
              >
                <Heart className={cn("w-6 h-6", likedTracks.has(currentTrack.id) && "fill-red-500")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleDislike}
                className={cn("text-white hover:bg-white/10", dislikedTracks.has(currentTrack.id) && "text-blue-400")}
                title="별로예요"
              >
                <ThumbsDown className={cn("w-6 h-6", dislikedTracks.has(currentTrack.id) && "fill-blue-400")} />
              </Button>
            </div>
          </div>

          {/* 진행 바 (반복 버튼 제거) */}
          <div className="mb-6">
            <Slider value={[currentTime]} max={duration || 0} step={1} onValueChange={handleSeek} className="mb-2" />
            <div className="flex justify-between text-sm text-white/60">
              <span>{formatTime(currentTime)}</span>
              <span>{formatRemain(currentTime)}</span>
            </div>
          </div>

          {/* 하단 컨트롤: 업로드 · 이전 · 재생 · 다음 · 재생목록 */}
          <div className="flex items-center justify-center gap-6 mb-6">
            {/* 업로드(좌측) */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleUploadClick}
              className="text-white hover:bg-white/10 w-12 h-12"
              title="업로드"
            >
              <Upload className="w-6 h-6" />
            </Button>

            <Button variant="ghost" size="icon" onClick={handlePrevious} className="text-white hover:bg-white/10 w-12 h-12">
              <SkipBack className="w-7 h-7 fill-white" />
            </Button>

            <Button
              size="lg"
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-white hover:bg-white/90 text-black shadow-lg"
              title={isPlaying ? "일시정지" : "재생"}
            >
              {isPlaying ? <Pause className="w-8 h-8 fill-black" /> : <Play className="w-8 h-8 ml-1 fill-black" />}
            </Button>

            <Button variant="ghost" size="icon" onClick={handleNext} className="text-white hover:bg-white/10 w-12 h-12">
              <SkipForward className="w-7 h-7 fill-white" />
            </Button>

            {/* 재생목록(우측) */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPlaylist(true)}
              className="text-white hover:bg-white/10 w-12 h-12"
              title="재생목록"
            >
              <ListMusic className="w-6 h-6" />
            </Button>
          </div>
        </div>

        {/* 숨겨진 파일 입력 */}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

        <audio ref={audioRef} preload="metadata" />
      </div>

      {/* 재생목록 시트 */}
      {showPlaylist && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowPlaylist(false)} />}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 bg-neutral-900 rounded-t-3xl z-50 transition-transform duration-300 ease-out",
          showPlaylist ? "translate-y-0" : "translate-y-full",
        )}
        style={{ maxHeight: "70vh" }}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4 text-white">
            <h2 className="text-xl font-bold">재생목록</h2>
            <Button variant="ghost" size="icon" onClick={() => setShowPlaylist(false)} className="text-white hover:bg-white/10">
              ✕
            </Button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "calc(70vh - 100px)" }}>
            {playlist.map((track, index) => (
              <button
                key={track.id}
                onClick={() => selectTrack(index)}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors text-left text-white",
                  currentTrackIndex === index && "bg-white/10",
                )}
              >
                <img
                  src={analyzedPhotoUrl || track.coverUrl || "/placeholder.svg"}
                  alt={track.title}
                  className="w-14 h-14 rounded object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className={cn("font-medium truncate", currentTrackIndex === index ? "text-white" : "text-white/90")}>
                    {track.title}
                  </p>
                  <p className="text-sm text-white/60 truncate">{track.artist}</p>
                </div>
                {currentTrackIndex === index && isPlaying && (
                  <div className="flex-shrink-0">
                    <div className="flex gap-1 items-end h-4" aria-hidden>
                      <div className="w-1 bg-white animate-pulse" style={{ height: "60%" }} />
                      <div className="w-1 bg-white animate-pulse" style={{ height: "100%", animationDelay: "0.2s" }} />
                      <div className="w-1 bg-white animate-pulse" style={{ height: "40%", animationDelay: "0.4s" }} />
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
