// src/app/recommend/RecommendClient.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play, Pause, SkipBack, SkipForward,
  ChevronDown, MoreVertical, Heart, ThumbsDown,
  ListMusic, Upload, VolumeX, Volume1, Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";

// ✅ 전역 플레이어
import { usePlayer } from "@/contexts/PlayerContext";

type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;
  coverUrl?: string | null;
  duration?: number | null;
  spotify_track_id?: string | null;
  spotify_uri?: string | null;
  selected_from?: "main" | "sub" | "preferred" | null;
};

const buildPhotoSrc = (photoId?: string | null) => {
  if (!photoId) return null;
  const id = encodeURIComponent(String(photoId));
  return `${API_BASE}/api/photos/${id}/binary`;
};

const normalizeTrack = (raw: any, idx: number): Track | null => {
  const title = raw?.title ?? raw?.music_title ?? raw?.name ?? null;
  const artist = raw?.artist ?? raw?.music_artist ?? raw?.singer ?? "Unknown";
  if (!title) return null;

  const preview =
    raw?.audio_url ?? raw?.preview_url ?? raw?.previewUrl ?? raw?.stream_url ?? null;
  const audioUrl = preview === "EMPTY" ? null : preview;

  const coverUrl =
    raw?.cover_url ?? raw?.album_image ?? raw?.albumImage ?? raw?.image ?? null;

  const duration =
    Number(raw?.duration ?? raw?.length_seconds ?? raw?.preview_duration ?? 0) || null;

  const spotify_uri: string | null = raw?.spotify_uri ?? null;
  let spotify_track_id: string | null = raw?.spotify_track_id ?? null;
  if (!spotify_track_id && typeof spotify_uri === "string" && spotify_uri.startsWith("spotify:track:")) {
    spotify_track_id = spotify_uri.split(":").pop() || null;
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
  };
};

export default function RecommendClient() {
  const router = useRouter();
  const player = usePlayer(); // ⭐ 전역 플레이어 사용

  const [photoId, setPhotoId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("photoId") || sp.get("photoID") || sp.get("id");
    setPhotoId(id);
  }, []);
  const analyzedPhotoUrl = useMemo(() => buildPhotoSrc(photoId), [photoId]);

  const userNameFallback =
    typeof window !== "undefined"
      ? localStorage.getItem("user_name") || localStorage.getItem("name")
      : null;
  const playlistTitle = `${userNameFallback || "내"} 플레이리스트`;

  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 좋아요 / 싫어요 로컬만 유지
  const [likedTracks, setLikedTracks] = useState<Set<string | number>>(new Set());
  const [dislikedTracks, setDislikedTracks] = useState<Set<string | number>>(new Set());

  // 현재 페이지에서 보이는 “선택된 인덱스” — 전역 queue와 동기화
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  useEffect(() => {
    if (player.index != null) setCurrentTrackIndex(player.index);
  }, [player.index]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const route = `${window.location.pathname}${window.location.search}`;
      sessionStorage.setItem("lastPlayerRoute", route);
    }
  }, []);

  // 추천 목록 로드 → 전역 큐에 한 번에 넣기
  useEffect(() => {
    const fetchPlaylist = async () => {
      setLoading(true);
      setError(null);
      try {
        const pid = photoId || "";
        const url = `${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(pid)}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json();

        let list: Track[] = [];
        if (data && (data.main_songs || data.sub_songs || data.preferred_songs)) {
          const tag = (arr: any[], tagName: Track["selected_from"]) =>
            (arr || []).map((r) => ({ ...r, selected_from: tagName }));
          const all = [
            ...tag(data.main_songs, "main"),
            ...tag(data.sub_songs, "sub"),
            ...tag(data.preferred_songs, "preferred"),
          ];
          list = all.map((r, i) => normalizeTrack(r, i)).filter(Boolean) as Track[];
        }

        setPlaylist(list);

        // ⭐ 전역 큐 갱신(표시만 갱신, 자동재생은 하지 않음)
        player.setQueueFromRecommend(list);
        setCurrentTrackIndex(0);
      } catch (e: any) {
        console.error(e);
        setError("추천 목록을 불러오지 못했습니다.");
        setPlaylist([]);
        player.setQueueFromRecommend([]); // 비움
        setCurrentTrackIndex(0);
      } finally {
        setLoading(false);
      }
    };
    if (photoId !== null) void fetchPlaylist();
  }, [photoId, player]);

  const currentTrack = playlist[currentTrackIndex];

  // 진행바/시간/볼륨은 전역 상태 사용
  const curSec = Math.floor((player.state.position || 0) / 1000);
  const durSec = Math.floor((player.state.duration || 0) / 1000);
  const isPlaying = !player.state.paused;
  const volume = player.volume;

  const formatTime = (s: number) => {
    const m = Math.floor((s || 0) / 60);
    const t = Math.floor((s || 0) % 60);
    return `${m}:${t.toString().padStart(2, "0")}`;
  };

  const toggleLike = () => {
    if (!currentTrack) return;
    const next = new Set(likedTracks);
    if (next.has(currentTrack.id)) next.delete(currentTrack.id);
    else {
      next.add(currentTrack.id);
      if (dislikedTracks.has(currentTrack.id)) {
        const d = new Set(dislikedTracks);
        d.delete(currentTrack.id);
        setDislikedTracks(d);
      }
    }
    setLikedTracks(next);
  };
  const toggleDislike = () => {
    if (!currentTrack) return;
    const next = new Set(dislikedTracks);
    if (next.has(currentTrack.id)) next.delete(currentTrack.id);
    else {
      next.add(currentTrack.id);
      if (likedTracks.has(currentTrack.id)) {
        const l = new Set(likedTracks);
        l.delete(currentTrack.id);
        setLikedTracks(l);
      }
    }
    setDislikedTracks(next);
  };

  const [showPlaylist, setShowPlaylist] = useState(false);

  // ▶ 버튼: 현재 큐가 이 페이지의 큐이므로 단순 toggle
  const onTogglePlay = () => player.toggle();

  // ◀ / ▶
  const handlePrevious = () => player.prev();
  const handleNext = () => player.next();

  // 시크
  const handleSeek = (value: number[]) =>
    player.seek(Math.max(0, Math.min(durSec || 0, value[0])) * 1000);

  // 목록에서 곡 선택
  const selectTrack = async (index: number) => {
    setCurrentTrackIndex(index);
    await player.playAt(index); // 전역 플레이어가 알아서 transfer/URI/preview 핸들링
    setShowPlaylist(false);
  };

  // 편집 페이지로 이동
  const goEdit = () => {
    if (!photoId) return alert("사진 정보가 없습니다.");
    const cur = playlist[currentTrackIndex];
    const q = new URLSearchParams();
    q.set("photoId", String(photoId));
    if (cur?.id) q.set("musicId", String(cur.id));
    if (cur?.selected_from) q.set("selected_from", String(cur.selected_from));
    router.push(`/editor?${q.toString()}`);
  };

  // 아트워크: 분석 이미지 고정(리스트 썸네일은 앨범)
  const artUrl = analyzedPhotoUrl ?? "/placeholder.svg";

  // 볼륨
  const setVol = useCallback((vals: number[]) => {
    const v01 = Math.min(1, Math.max(0, (vals?.[0] ?? 0) / 100));
    player.setVolume(v01);
  }, [player]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-neutral-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        {/* 헤더 */}
        <div className="relative flex items-center mb-6 text-white">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={() => router.push("/?from=player")}
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

          {/* 제목/아티스트 */}
          <div className="flex items-start justify-between text-white mb-6">
            <div className="flex-1">
              <h1 className="text-2xl font-bold mb-1">
                {currentTrack?.title || (loading ? "불러오는 중..." : "—")}
              </h1>
              <p className="text-base text-white/70">{currentTrack?.artist || "Unknown"}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleLike}
                className={cn(
                  "text-white hover:bg-white/10",
                  currentTrack && likedTracks.has(currentTrack.id) && "text-red-500",
                )}
                title="좋아요"
              >
                <Heart
                  className={cn(
                    "w-6 h-6",
                    currentTrack && likedTracks.has(currentTrack.id) && "fill-red-500",
                  )}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleDislike}
                className={cn(
                  "text-white hover:bg-white/10",
                  currentTrack && dislikedTracks.has(currentTrack.id) && "text-blue-400",
                )}
                title="별로예요"
              >
                <ThumbsDown
                  className={cn(
                    "w-6 h-6",
                    currentTrack && dislikedTracks.has(currentTrack.id) && "fill-blue-400",
                  )}
                />
              </Button>
            </div>
          </div>

          {/* 진행바 */}
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
                onClick={handlePrevious}
                className="text-white hover:bg-white/10 w-12 h-12"
                title="이전"
              >
                <SkipBack className="w-7 h-7 fill-white" />
              </Button>
            </div>

            <Button
              size="lg"
              onClick={onTogglePlay}
              className="w-16 h-16 rounded-full bg-white hover:bg-white/90 text-black shadow-lg"
              title={isPlaying ? "일시정지" : "재생"}
            >
              {isPlaying ? <Pause className="w-8 h-8 fill-black" /> : <Play className="w-8 h-8 ml-1 fill-black" />}
            </Button>

            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNext}
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
              <div className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="음소거/해제">
                {volume === 0 ? <VolumeX className="w-6 h-6" /> : volume < 0.5 ? <Volume1 className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
              </div>
              <div className="flex-1">
                <Slider
                  value={[Math.round((volume || 0) * 100)]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={setVol}
                />
              </div>
              <div className="w-12 text-right text-sm text-white/70 tabular-nums">
                {Math.round((volume || 0) * 100)}%
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
            {!loading &&
              playlist.map((track, index) => (
                <button
                  key={`${track.id}-${index}`}
                  onClick={() => selectTrack(index)}
                  className={cn(
                    "w-full flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors text-left",
                    currentTrackIndex === index && "bg-white/10",
                  )}
                >
                  <img
                    src={track.coverUrl || "/placeholder.svg"}
                    alt={track.title}
                    className="w-14 h-14 rounded object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium truncate", currentTrackIndex === index ? "text-white" : "text-white/90")}>
                      {track.title}
                    </p>
                    <p className="text-sm text-white/60 truncate">
                      {track.artist}
                      <span className="ml-2 text-xs text-white/50">
                        {track.spotify_track_id || track.spotify_uri ? "Spotify" : (track.audioUrl ? "Preview" : "—")}
                      </span>
                    </p>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
