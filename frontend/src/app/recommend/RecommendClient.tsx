// src/app/recommend/RecommendClient.tsx
"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Play, Pause, SkipBack, SkipForward,
  ChevronDown, MoreVertical, Heart, ThumbsDown, ListMusic, Upload,
} from "lucide-react"
import { VolumeX, Volume1, Volume2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { API_BASE } from "@/lib/api"
import { usePlayer } from "@/contexts/PlayerContext"

type Track = {
  id: string | number
  title: string
  artist: string
  audioUrl?: string | null
  coverUrl?: string | null
  duration?: number | null
  spotify_track_id?: string | null
  spotify_uri?: string | null
  selected_from?: "main" | "sub" | "preferred" | null
}

const buildPhotoSrc = (photoId?: string | null) =>
  photoId ? `${API_BASE}/api/photos/${encodeURIComponent(String(photoId))}/binary` : null

// 서버 응답 다형성 대응
const normalizeTrack = (raw: any, idx: number): Track | null => {
  const title = raw?.title ?? raw?.music_title ?? raw?.name ?? null
  const artist = raw?.artist ?? raw?.music_artist ?? raw?.singer ?? "Unknown"
  if (!title) return null

  const preview =
    raw?.audio_url ?? raw?.preview_url ?? raw?.previewUrl ?? raw?.stream_url ?? null
  const audioUrl = preview === "EMPTY" ? null : preview

  const coverUrl =
    raw?.cover_url ?? raw?.album_image ?? raw?.albumImage ?? raw?.image ?? null

  const duration =
    Number(raw?.duration ?? raw?.length_seconds ?? raw?.preview_duration ?? 0) || null

  const spotify_uri: string | null = raw?.spotify_uri ?? null
  let spotify_track_id: string | null = raw?.spotify_track_id ?? null
  if (!spotify_track_id && typeof spotify_uri === "string" && spotify_uri.startsWith("spotify:track:")) {
    spotify_track_id = spotify_uri.split(":").pop() || null
  }

  return {
    id: raw?.id ?? raw?.music_id ?? idx,
    title,
    artist,
    audioUrl,
    coverUrl,
    duration,
    spotify_track_id,
    spotify_uri,
    selected_from: raw?.selected_from ?? null,
  }
}

/** 추천목록을 한 번에 커버/미리듣기로 보강(백엔드 batch 사용; 없어도 정상동작) */
async function prefetchCoversAndUris(list: Track[]): Promise<Track[]> {
  if (!list?.length) return list
  const norm = (s?: string | null) =>
    (s || "").replace(/\s+/g, " ").replace(/[[(（【].*?[)\]）】]/g, "").trim().toLowerCase()

  const pairs = list.map(t => ({ title: norm(t.title), artist: norm(t.artist) }))

  try {
    const res = await fetch(`${API_BASE}/api/spotify/search/batch`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
    })
    if (!res.ok) return list
    const j = await res.json()
    const items: Array<{
      key: string
      id: string | null
      title: string | null
      artist: string | null
      album: string | null
      albumImage: string | null
      preview_url: string | null
      spotify_uri: string | null
    }> = j?.items || []

    const keyOf = (t: Track) => `${norm(t.title)} - ${norm(t.artist)}`
    const map = new Map(items.map(it => [it.key || `${norm(it.title)} - ${norm(it.artist)}`, it]))

    return list.map(t => {
      const hit = map.get(keyOf(t))
      if (!hit) return t
      const uri = hit.spotify_uri || (hit.id ? `spotify:track:${hit.id}` : null)
      return {
        ...t,
        coverUrl: t.coverUrl || hit.albumImage || null,
        audioUrl: t.audioUrl || hit.preview_url || null,
        spotify_uri: t.spotify_uri || uri || null,
        spotify_track_id: t.spotify_track_id || hit.id || (uri?.split(":").pop() || null),
      }
    })
  } catch {
    return list
  }
}

export default function RecommendClient() {
  const router = useRouter()
  const player = usePlayer() // PlayerContext (전역 오디오)

  const [photoId, setPhotoId] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === "undefined") return
    const qs = new URLSearchParams(window.location.search)
    setPhotoId(qs.get("photoId") || qs.get("photoID") || qs.get("id"))
  }, [])
  const analyzedPhotoUrl = useMemo(() => buildPhotoSrc(photoId), [photoId])

  const userNameFallback =
    typeof window !== "undefined"
      ? localStorage.getItem("user_name") || localStorage.getItem("name")
      : null
  const playlistTitle = `${(userNameFallback || "내")} 플레이리스트`

  const [playlist, setPlaylist] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [likedTracks, setLikedTracks] = useState<Set<string | number>>(new Set())
  const [dislikedTracks, setDislikedTracks] = useState<Set<string | number>>(new Set())

  // 추천 목록 로드 → 전역 큐 세팅(Provider가 자동 로드+재생)
  useEffect(() => {
    const run = async () => {
      if (photoId == null) return
      setLoading(true)
      setError(null)
      try {
        const url = `${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}`
        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: any = await res.json()

        let list: Track[] = []
        if (data && (data.main_songs || data.sub_songs || data.preferred_songs)) {
          const tag = (arr: any[], tagName: Track["selected_from"]) =>
            (arr || []).map((r) => ({ ...r, selected_from: tagName }))
          const all = [
            ...tag(data.main_songs, "main"),
            ...tag(data.sub_songs, "sub"),
            ...tag(data.preferred_songs, "preferred"),
          ]
          list = all.map((r, i) => normalizeTrack(r, i)).filter(Boolean) as Track[]
        }

        // 한 번에 커버/미리듣기 보강(있으면 사용)
        const enhanced = await prefetchCoversAndUris(list)
        setPlaylist(enhanced)

        // 전역 플레이어 큐 설정(첫 곡부터 재생)
        player.setQueueFromRecommend(enhanced, 0)
      } catch (e) {
        console.error(e)
        setError("추천 목록을 불러오지 못했습니다.")
        setPlaylist([])
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [photoId, player])

  // 표시용 현재 트랙
  const curIndex = player.state.index
  const current = playlist[curIndex]

  // 진행바 / 재생상태 / 볼륨
  const curSec = Math.floor((player.state.curMs || 0) / 1000)
  const durSec = Math.floor((player.state.durMs || 0) / 1000)
  const isPlaying = player.isPlaying
  const volume = player.volume

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const t = Math.floor(s % 60)
    return `${m}:${t.toString().padStart(2, "0")}`
  }

  const handleSeek = (value: number[]) => player.seek((value?.[0] ?? 0) * 1000)

  const toggleLike = () => {
    if (!current) return
    const next = new Set(likedTracks)
    if (next.has(current.id)) next.delete(current.id)
    else {
      next.add(current.id)
      if (dislikedTracks.has(current.id)) {
        const d = new Set(dislikedTracks); d.delete(current.id); setDislikedTracks(d)
      }
    }
    setLikedTracks(next)
  }
  const toggleDislike = () => {
    if (!current) return
    const next = new Set(dislikedTracks)
    if (next.has(current.id)) next.delete(current.id)
    else {
      next.add(current.id)
      if (likedTracks.has(current.id)) {
        const l = new Set(likedTracks); l.delete(current.id); setLikedTracks(l)
      }
    }
    setDislikedTracks(next)
  }

  const selectTrack = (index: number) => {
    // Provider는 index를 외부에서 직접 못 바꾸므로 큐를 같은 배열로 재설정하면서 시작 인덱스만 바꿔줌
    player.setQueueFromRecommend(playlist, index)
    setShowPlaylist(false)
  }

  const goEdit = () => {
    if (!photoId) return alert("사진 정보가 없습니다.")
    const cur = current || playlist[0]
    const q = new URLSearchParams()
    q.set("photoId", String(photoId))
    if (cur?.id) q.set("musicId", String(cur.id))
    if (cur?.selected_from) q.set("selected_from", String(cur.selected_from))
    router.push(`/editor?${q.toString()}`)
  }

  // 대표 아트워크는 분석 이미지 유지
  const artUrl = analyzedPhotoUrl ?? "/placeholder.svg"

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-neutral-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        {/* 헤더 */}
        <div className="relative flex items-center mb-6 text-white">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={() => { 
              router.push("/"); 
            }}
            title="메인으로"
          >
            <ChevronDown className="w-6 h-6" />
          </Button>

          <div className="absolute left-1/2 -translate-x-1/2">
            <p className="text-sm font-medium text-center">{playlistTitle}</p>
          </div>

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
            <img src={artUrl} alt="artwork" className="w-full h-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
          </div>

          {/* 제목 영역 */}
          <div className="flex items-start justify-between text-white mb-6">
            <div className="flex-1">
              <h1 className="text-2xl font-bold mb-1">
                {current?.title || (loading ? "불러오는 중..." : "—")}
              </h1>
              <p className="text-base text-white/70">{current?.artist || "Unknown"}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleLike}
                className={cn(
                  "text-white hover:bg-white/10",
                  current && likedTracks.has(current.id) && "text-red-500",
                )}
                title="좋아요"
              >
                <Heart
                  className={cn(
                    "w-6 h-6",
                    current && likedTracks.has(current.id) && "fill-red-500",
                  )}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleDislike}
                className={cn(
                  "text-white hover:bg-white/10",
                  current && dislikedTracks.has(current.id) && "text-blue-400",
                )}
                title="별로예요"
              >
                <ThumbsDown
                  className={cn(
                    "w-6 h-6",
                    current && dislikedTracks.has(current.id) && "fill-blue-400",
                  )}
                />
              </Button>
            </div>
          </div>

          {/* 진행 바 */}
          <div className="mb-6">
            <Slider
              value={[Math.min(curSec, durSec || 0)]}
              max={durSec || 0}
              step={1}
              onValueChange={handleSeek}
              className="mb-2"
            />
            <div className="flex justify-between text-sm text-white/60">
              <span>{formatTime(curSec)}</span>
              <span>{`-${formatTime(Math.max((durSec || 0) - curSec, 0))}`}</span>
            </div>
          </div>

          {/* 컨트롤 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={goEdit}
                className="text-white hover:bg-white/10 w-12 h-12"
                title="편집/공유"
              >
                <Upload className="w-6 h-6" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={player.prev}
                className="text-white hover:bg-white/10 w-12 h-12"
                title="이전"
              >
                <SkipBack className="w-7 h-7 fill-white" />
              </Button>
            </div>

            <Button
              size="lg"
              onClick={isPlaying ? player.pause : player.play}
              className="w-16 h-16 rounded-full bg-white hover:bg-white/90 text-black shadow-lg"
              title={isPlaying ? "일시정지" : "재생"}
            >
              {isPlaying ? <Pause className="w-8 h-8 fill-black" /> : <Play className="w-8 h-8 ml-1 fill-black" />}
            </Button>

            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={player.next}
                className="text-white hover:bg-white/10 w-12 h-12"
                title="다음"
              >
                <SkipForward className="w-7 h-7 fill-white" />
              </Button>
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

          {/* 볼륨 */}
          <div className="mt-2 mb-2">
            <div className="flex items-center gap-3 text-white">
              <button
                onClick={() => player.setVolume(volume > 0 ? 0 : 0.8)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                title={volume === 0 ? "음소거 해제" : "음소거"}
                aria-label="볼륨"
              >
                {volume === 0 ? <VolumeX className="w-6 h-6" /> : volume < 0.5 ? <Volume1 className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
              </button>

              <div className="flex-1">
                <Slider
                  value={[Math.round(volume * 100)]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(vals) => player.setVolume((vals?.[0] ?? 0) / 100)}
                />
              </div>

              <div className="w-12 text-right text-sm text-white/70 tabular-nums">
                {Math.round(volume * 100)}%
              </div>
            </div>
          </div>
        </div>
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
        <div className="p-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">추천 재생목록</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPlaylist(false)}
              className="text-white hover:bg-white/10"
              title="닫기"
            >
              ✕
            </Button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "calc(70vh - 100px)" }}>
            {error && <p className="text-red-400 mb-3">{error}</p>}
            {loading && <p className="text-white/70">불러오는 중...</p>}
            {!loading && playlist.map((track, index) => (
              <button
                key={`${track.id}-${index}`}
                onClick={() => selectTrack(index)}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors text-left",
                  curIndex === index && "bg-white/10",
                )}
              >
                <img
                  src={track.coverUrl || "/placeholder.svg"}
                  alt={track.title}
                  className="w-14 h-14 rounded object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className={cn("font-medium truncate", curIndex === index ? "text-white" : "text-white/90")}>
                    {track.title}
                  </p>
                  <p className="text-sm text-white/60 truncate">
                    {track.artist}
                    <span className="ml-2 text-xs text-white/50">
                      {track.audioUrl ? "Preview" : "—"}
                    </span>
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
