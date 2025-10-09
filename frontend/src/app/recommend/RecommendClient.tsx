"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  ChevronDown,
  MoreVertical,
  Heart,
  ThumbsDown,
  Wand2,
  X,
  ListMusic,
  Shuffle,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Track {
  id: number
  title: string
  artist: string
  album: string
  /** 초 단위(선택). 없으면 loadedmetadata로 보정 */
  duration?: number
  coverUrl: string
  /** 실제 오디오 파일 경로(필수!) */
  audioUrl: string
  playlist: string
}

const playlist: Track[] = [
  {
    id: 1,
    title: "TOO BAD",
    artist: "G-DRAGON, Anderson.Paak",
    album: "Übermensch",
    duration: 153,
    coverUrl: "/album-cover.png",
    audioUrl: "/audio/track1.mp3", // 👉 public/audio/track1.mp3 에 파일 배치
    playlist: "009 실시간 멜론 차트 TOP 100 MELON",
  },
  {
    id: 2,
    title: "Electric Pulse",
    artist: "Neon Waves",
    album: "Synthetic Hearts",
    duration: 198,
    coverUrl: "/abstract-music-album-cover-electric-purple.jpg",
    audioUrl: "/audio/track2.mp3",
    playlist: "009 실시간 멜론 차트 TOP 100 MELON",
  },
  {
    id: 3,
    title: "Golden Hour",
    artist: "Sunset Boulevard",
    album: "Summer Memories",
    duration: 223,
    coverUrl: "/abstract-music-album-cover-golden-sunset.jpg",
    audioUrl: "/audio/track3.mp3",
    playlist: "009 실시간 멜론 차트 TOP 100 MELON",
  },
]

export default function RecommendClient() {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off")
  const [isShuffled, setIsShuffled] = useState(false)
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [likedTracks, setLikedTracks] = useState<Set<number>>(new Set())
  const [dislikedTracks, setDislikedTracks] = useState<Set<number>>(new Set())
  const [duration, setDuration] = useState<number>(playlist[0].duration ?? 0)

  const audioRef = useRef<HTMLAudioElement>(null)
  const currentTrack = playlist[currentTrackIndex]

  /** 트랙 로드 */
  const loadCurrentTrack = useCallback(async (autoplay = false) => {
    const audio = audioRef.current
    if (!audio) return

    try {
      setCurrentTime(0)
      audio.src = currentTrack.audioUrl
      audio.load()

      // duration 보정
      const onLoaded = () => {
        const d = Math.floor(audio.duration || 0)
        setDuration(currentTrack.duration ?? d)
      }
      audio.addEventListener("loadedmetadata", onLoaded, { once: true })

      if (autoplay) {
        const playPromise = audio.play()
        if (playPromise && typeof playPromise.then === "function") {
          await playPromise
          setIsPlaying(true)
        } else {
          setIsPlaying(true)
        }
      }
    } catch {
      setIsPlaying(false)
    }
  }, [currentTrack])

  /** 초기/트랙 변경 시 */
  useEffect(() => {
    void loadCurrentTrack(isPlaying) // 재생 중에 트랙 바뀌면 이어서 재생
  }, [currentTrackIndex, loadCurrentTrack]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 진행도/트랙 종료 처리 */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setCurrentTime(audio.currentTime)
    const onEnded = () => {
      if (repeatMode === "one") {
        audio.currentTime = 0
        void audio.play()
        return
      }
      handleNext()
    }

    audio.addEventListener("timeupdate", onTime)
    audio.addEventListener("ended", onEnded)
    return () => {
      audio.removeEventListener("timeupdate", onTime)
      audio.removeEventListener("ended", onEnded)
    }
  }, [repeatMode])

  /** 재생/일시정지 */
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
        // 사용자 제스처 없을 때 실패 가능
        setIsPlaying(false)
      }
    }
  }

  /** 이전 트랙 */
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

  /** 다음 트랙(+셔플/반복) */
  const handleNext = () => {
    if (isShuffled) {
      // 현재 인덱스 제외 랜덤
      const pool = playlist.map((_, i) => i).filter((i) => i !== currentTrackIndex)
      const next = pool[Math.floor(Math.random() * pool.length)]
      setCurrentTrackIndex(next)
      return
    }

    if (currentTrackIndex < playlist.length - 1) {
      setCurrentTrackIndex(currentTrackIndex + 1)
    } else if (repeatMode === "all") {
      setCurrentTrackIndex(0)
    } else {
      setIsPlaying(false)
    }
  }

  /** 탐색 */
  const handleSeek = (value: number[]) => {
    const audio = audioRef.current
    if (!audio) return
    const v = Math.min(Math.max(value[0], 0), duration || 0)
    audio.currentTime = v
    setCurrentTime(v)
  }

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60)
    const secs = Math.floor(s % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }
  const formatRemain = (s: number) => {
    const remain = Math.max((duration || 0) - s, 0)
    const mins = Math.floor(remain / 60)
    const secs = Math.floor(remain % 60)
    return `-${mins}:${secs.toString().padStart(2, "0")}`
  }

  const toggleRepeat = () => {
    const modes: Array<"off" | "all" | "one"> = ["off", "all", "one"]
    const idx = modes.indexOf(repeatMode)
    setRepeatMode(modes[(idx + 1) % modes.length])
  }

  const toggleShuffle = () => setIsShuffled((p) => !p)

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-neutral-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6 text-white">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
              <ChevronDown className="w-6 h-6" />
            </Button>
            <div>
              <p className="text-sm font-medium">{currentTrack.playlist}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPlaylist(true)}
              className="text-white hover:bg-white/10"
              title="재생목록 열기"
            >
              <ListMusic className="w-6 h-6" />
            </Button>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
              <MoreVertical className="w-6 h-6" />
            </Button>
          </div>
        </div>

        <div className="mb-8">
          <div
            className="relative w-full aspect-square rounded-lg overflow-hidden shadow-2xl mb-6"
            onClick={() => setShowPlaylist(true)}
            role="button"
            aria-label="재생목록 열기"
          >
            <img src={currentTrack.coverUrl || "/placeholder.svg"} alt={currentTrack.title} className="w-full h-full object-cover" />
          </div>

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

          <div className="mb-6">
            <Slider
              value={[currentTime]}
              max={duration || 0}
              step={1}
              onValueChange={handleSeek}
              className="mb-2"
            />
            <div className="flex justify-between text-sm text-white/60">
              <span>{formatTime(currentTime)}</span>
              <span>{formatRemain(currentTime)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between mb-6 px-2">
            <Button
              variant={isShuffled ? "default" : "ghost"}
              size="icon"
              onClick={toggleShuffle}
              className={cn("w-12 h-12", isShuffled ? "bg-white text-black" : "text-white hover:bg-white/10")}
              title="셔플"
            >
              <Shuffle className="w-5 h-5" />
            </Button>

            <Button variant="ghost" size="icon" onClick={handlePrevious} className="text-white hover:bg-white/10 w-12 h-12">
              <SkipBack className="w-7 h-7 fill-white" />
            </Button>

            <Button
              size="lg"
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-white hover:bg-white/90 text-black shadow-lg"
            >
              {isPlaying ? <Pause className="w-8 h-8 fill-black" /> : <Play className="w-8 h-8 ml-1 fill-black" />}
            </Button>

            <Button variant="ghost" size="icon" onClick={handleNext} className="text-white hover:bg-white/10 w-12 h-12">
              <SkipForward className="w-7 h-7 fill-white" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleRepeat}
              className={cn("text-white hover:bg-white/10 w-12 h-12 relative", repeatMode !== "off" && "text-primary")}
              title={`반복: ${repeatMode}`}
            >
              <Repeat className="w-5 h-5" />
              {repeatMode === "one" && (
                <span className="absolute text-[10px] font-bold top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  1
                </span>
              )}
            </Button>
          </div>
        </div>

        <audio ref={audioRef} preload="metadata" />
      </div>

      {showPlaylist && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowPlaylist(false)} />}

      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 bg-neutral-900 rounded-t-3xl z-50 transition-transform duration-300 ease-out",
          showPlaylist ? "translate-y-0" : "translate-y-full",
        )}
        style={{ maxHeight: "70vh" }}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">재생목록</h2>
            <Button variant="ghost" size="icon" onClick={() => setShowPlaylist(false)} className="text-white hover:bg-white/10">
              <X className="w-6 h-6" />
            </Button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "calc(70vh - 100px)" }}>
            {playlist.map((track, index) => (
              <button
                key={track.id}
                onClick={() => selectTrack(index)}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors text-left",
                  currentTrackIndex === index && "bg-white/10",
                )}
              >
                <img src={track.coverUrl || "/placeholder.svg"} alt={track.title} className="w-14 h-14 rounded object-cover flex-shrink-0" />
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
