// src/app/recommend/RecommendClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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
  Upload,
  VolumeX,
  Volume1,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { usePlayer, Track } from "@/contexts/PlayerContext";
import { useSpotifyStatus } from "@/contexts/SpotifyStatusContext";
import { formatTime } from "./utils/media";

/** 사진 바이너리 URL */
const buildPhotoSrc = (photoId?: string | null) =>
  photoId
    ? `${API_BASE}/api/photos/${encodeURIComponent(String(photoId))}/binary`
    : null;

/** 서버 응답을 Track으로 정규화 */
const normalizeTrack = (raw: any, idx: number): Track | null => {
  const title = raw?.title ?? raw?.music_title ?? raw?.name ?? null;
  const artist = raw?.artist ?? raw?.music_artist ?? raw?.singer ?? "Unknown";
  if (!title) return null;

  const preview =
    raw?.audio_url ??
    raw?.preview_url ??
    raw?.previewUrl ??
    raw?.stream_url ??
    null;
  const audioUrl = preview === "EMPTY" ? null : preview;

  const coverUrl =
    raw?.cover_url ?? raw?.album_image ?? raw?.albumImage ?? raw?.image ?? null;

  let duration: number | null = null;
  if (typeof raw?.duration === "number") {
    duration = raw.duration;
  } else if (typeof raw?.length_seconds === "number") {
    duration = raw.length_seconds;
  } else if (typeof raw?.preview_duration === "number") {
    duration = raw.preview_duration; // 초 단위
  } else if (typeof raw?.duration_ms === "number") {
    duration = raw.duration_ms / 1000; // ms → s
  }

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
    spotify_uri,
    spotify_track_id,
    selected_from: raw?.selected_from ?? null,
  };
};

/** 커버/미리듣기/Spotify URI 배치 보강 */
async function prefetchCoversAndUris(list: Track[]): Promise<Track[]> {
  if (!list?.length) return list;

  const norm = (s?: string | null) =>
    (s || "")
      .replace(/\s+/g, " ")
      .replace(/[[(（【].*?[)\]）】]/g, "")
      .trim()
      .toLowerCase();

  const pairs = list.map((t) => ({ title: norm(t.title), artist: norm(t.artist) }));

  try {
    const res = await fetch(`${API_BASE}/api/spotify/search/batch`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
    });
    if (!res.ok) {
      console.warn("batch search failed:", res.status);
      return list;
    }
    const j = await res.json();
    type BatchItem = {
      key?: string | null; // key가 null일 수 있음
      id: string | null;
      title: string | null;
      artist: string | null;
      album: string | null;
      albumImage: string | null;
      preview_url: string | null;
      spotify_uri: string | null;
      duration_ms?: number;
    };
    const items: (BatchItem | null)[] = j?.items || [];

    const validItems = items.filter((it): it is BatchItem & { key: string } =>
      it != null && typeof it.key === 'string' && it.key.length > 0
    );

    const keyOf = (t: Track) => `${norm(t.title)} - ${norm(t.artist)}`;
    const map = new Map(
      validItems.map((it) => [it.key, it])
    );

    return list.map((t) => {
      const hit = map.get(keyOf(t));
      if (!hit) return t;
      const uri = hit.spotify_uri || (hit.id ? `spotify:track:${hit.id}` : null);
      const hitDurationSec = typeof hit.duration_ms === "number" ? hit.duration_ms / 1000 : null;
      return {
        ...t,
        coverUrl: t.coverUrl || hit.albumImage || null,
        audioUrl: t.audioUrl || hit.preview_url || null,
        duration: t.duration ?? hitDurationSec,
        spotify_uri: t.spotify_uri || uri || null,
        spotify_track_id: t.spotify_track_id || hit.id || (uri?.split(":").pop() || null),
      };
    });
  } catch (e) {
    console.warn("batch search error:", e);
    return list;
  }
}

export default function RecommendClient() {
  const router = useRouter();
  const player = usePlayer();
  const { status: spotifyStatus } = useSpotifyStatus();

  // Spotify 연결 + SDK 준비 여부
  const isSpotifyConnected = (spotifyStatus?.connected ?? false) && player.isSpotifyReady;

  // --- 상태 ---
  const [photoId, setPhotoId] = useState<string | null>(null);
  const analyzedPhotoUrl = useMemo(() => buildPhotoSrc(photoId), [photoId]);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [likedTracks, setLikedTracks] = useState<Set<string | number>>(new Set());
  const [dislikedTracks, setDislikedTracks] = useState<Set<string | number>>(new Set());

  const lastQueueSigRef = useRef<string>("");
  const onceMountedRef = useRef<boolean>(false);

  // --- 사용자 이름 ---
  const userNameFallback = useMemo(
    () =>
      typeof window !== "undefined"
        ? localStorage.getItem("user_name") || localStorage.getItem("name")
        : null,
    []
  );
  const playlistTitle = `${userNameFallback || "내"} 플레이리스트`;

  // --- 라우팅/세션 저장 ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get("photoId") || qs.get("photoID") || qs.get("id");
    setPhotoId(id);
    if (id) {
      const route = `/recommend?photoId=${encodeURIComponent(id)}`;
      try {
        sessionStorage.setItem("lastPlayerRoute", route);
      } catch {}
    }
  }, []);

  // --- 추천 목록 로드 및 PlayerContext 큐 설정 ---
  const { setQueueAndPlay } = player;

  useEffect(() => {
    const run = async () => {
      if (photoId == null) return;

      if (!onceMountedRef.current) {
        onceMountedRef.current = true;
      } else if (lastQueueSigRef.current && playlist.length > 0) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const url = `${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}`;
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
          list = all
            .map((r, i) => normalizeTrack(r, i))
            .filter((t): t is Track => t !== null);
        }

        const enhanced = await prefetchCoversAndUris(list);

        const sig = JSON.stringify(
          enhanced.map((t) => [t.id, t.spotify_uri, !!t.audioUrl]).concat([enhanced.length])
        );

        if (sig === lastQueueSigRef.current) {
          if (!playlist.length) setPlaylist(enhanced);
          return;
        }
        lastQueueSigRef.current = sig;
        setPlaylist(enhanced);

        if (enhanced.length > 0) {
          setQueueAndPlay(enhanced, 0);
        } else {
          setQueueAndPlay([], 0);
        }
      } catch (e) {
        console.error(e);
        setError("추천 목록을 불러오지 못했습니다.");
        setQueueAndPlay([], 0);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [photoId, setQueueAndPlay, playlist.length]);

  // --- 현재 재생 정보/상태 ---
  const currentTrack = player.state.currentTrack;
  const isPlaying = player.isPlaying;
  const curMs = player.state.curMs;
  const durMs = player.state.durMs;
  const curSec = Math.floor(curMs / 1000);
  const durSec = Math.floor(durMs / 1000);
  const volume = player.volume;

  // --- 제어 핸들러 ---
  const handlePlayPause = player.togglePlayPause;
  const handleNext = player.next;
  const handlePrev = player.prev;
  const handleSeek = (value: number[]) => player.seek((value?.[0] ?? 0) * 1000);
  const handleSetVolume = player.setVolume;

  const selectTrack = useCallback(
    (index: number) => {
      if (!playlist || index < 0 || index >= playlist.length) return;
      const trackToPlay = playlist[index];
      player.play(trackToPlay, index);
      setShowPlaylist(false);
    },
    [playlist, player]
  );

  const goEdit = () => {
    if (!photoId) return alert("사진 정보가 없습니다.");
    const cur = currentTrack || playlist[0];
    const q = new URLSearchParams();
    q.set("photoId", String(photoId));
    if (cur?.id) q.set("musicId", String(cur.id));
    if (cur?.selected_from) q.set("selected_from", String(cur.selected_from));
    router.push(`/editor?${q.toString()}`);
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

  const artUrl = analyzedPhotoUrl || currentTrack?.coverUrl || "/placeholder.svg";

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
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold mb-1 line-clamp-2">
                {currentTrack?.title || (loading ? "불러오는 중..." : "—")}
              </h1>
              <p className="text-base text-white/70 truncate">{currentTrack?.artist || "Unknown"}</p>
              {player.state.playbackSource && (
                <p className="text-xs text-white/50 mt-1">
                  재생: {player.state.playbackSource === "spotify" ? "Spotify" : "미리듣기"}
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleLike}
                disabled={!currentTrack}
                className={cn(
                  "text-white hover:bg-white/10",
                  currentTrack && likedTracks.has(currentTrack.id) && "text-red-500"
                )}
                title="좋아요"
              >
                <Heart
                  className={cn(
                    "w-6 h-6",
                    currentTrack && likedTracks.has(currentTrack.id) && "fill-red-500"
                  )}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleDislike}
                disabled={!currentTrack}
                className={cn(
                  "text-white hover:bg-white/10",
                  currentTrack && dislikedTracks.has(currentTrack.id) && "text-blue-400"
                )}
                title="별로예요"
              >
                <ThumbsDown
                  className={cn(
                    "w-6 h-6",
                    currentTrack && dislikedTracks.has(currentTrack.id) && "fill-blue-400"
                  )}
                />
              </Button>
            </div>
          </div>

          {/* 진행 바 */}
          <div className="mb-6">
            <Slider
              value={[curSec]}
              max={durSec || 1}
              step={1}
              onValueChange={handleSeek}
              className="mb-2"
              disabled={!currentTrack || durSec === 0}
            />
            <div className="flex justify-between text-sm text-white/60">
              <span>{formatTime(curSec)}</span>
              <span>-{formatTime(Math.max(durSec - curSec, 0))}</span>
            </div>
          </div>

          {/* 컨트롤 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={goEdit}
                disabled={!photoId}
                className="text-white hover:bg-white/10 w-12 h-12"
                title="편집/공유"
              >
                <Upload className="w-6 h-6" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrev}
                disabled={!currentTrack}
                className="text-white hover:bg-white/10 w-12 h-12"
                title="이전"
              >
                <SkipBack className="w-7 h-7 fill-white" />
              </Button>
            </div>

            <Button
              size="lg"
              onClick={handlePlayPause}
              className="w-16 h-16 rounded-full bg-white hover:bg-white/90 text-black shadow-lg disabled:opacity-50"
              title={isPlaying ? "일시정지" : "재생"}
              disabled={!currentTrack || (!currentTrack.spotify_uri && !currentTrack.audioUrl)}
            >
              {isPlaying ? (
                <Pause className="w-8 h-8 fill-black" />
              ) : (
                <Play className="w-8 h-8 ml-1 fill-black" />
              )}
            </Button>

            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNext}
                disabled={!currentTrack}
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
                onClick={() => handleSetVolume(volume > 0 ? 0 : 0.8)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                title={volume === 0 ? "음소거 해제" : "음소거"}
                aria-label="볼륨"
              >
                {volume === 0 ? (
                  <VolumeX className="w-6 h-6" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-6 h-6" />
                ) : (
                  <Volume2 className="w-6 h-6" />
                )}
              </button>
              <div className="flex-1">
                <Slider
                  value={[Math.round(volume * 100)]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(vals) => handleSetVolume((vals?.[0] ?? 0) / 100)}
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
      {showPlaylist && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowPlaylist(false)} />
      )}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 bg-neutral-900 rounded-t-3xl z-50 transition-transform duration-300 ease-out",
          showPlaylist ? "translate-y-0" : "translate-y-full"
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
            {!loading && playlist.length === 0 && (
              <p className="text-white/70 text-center py-4">추천 목록이 없습니다.</p>
            )}
            {!loading && 
              playlist.map((track, index) => {
                // ✅ 연결/준비 여부 기준으로 '재생 가능' 판단
                const isPlayable = isSpotifyConnected ? !!track.spotify_uri : !!track.audioUrl;
                const isActive = index === player.state.index;

                return (
                  <button
                    key={`${track.id}-${index}`}
                    onClick={() => selectTrack(index)}
                    className={cn(
                      "w-full flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-colors text-left",
                      isActive && "bg-white/10",
                      !isPlayable && "opacity-50 cursor-not-allowed"
                    )}
                    disabled={!isPlayable}
                  >
                    <img
                      src={track.coverUrl || "/placeholder.svg"}
                      alt={track.title}
                      className="w-14 h-14 rounded object-cover flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={cn("font-medium truncate", isActive ? "text-white" : "text-white/90")}>
                        {track.title}
                      </p>
                      <p className="text-sm text-white/60 truncate">
                        {track.artist}
                        <span className="ml-2 text-xs text-white/50">
                          {isSpotifyConnected
                            ? track.spotify_uri
                              ? "Spotify"
                              : "재생 불가"
                            : track.audioUrl
                            ? "Preview"
                            : "미리듣기 없음"}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1 opacity-70">
                      {likedTracks.has(track.id) && (
                        <Heart className="w-4 h-4 text-red-500 fill-red-500" />
                      )}
                      {dislikedTracks.has(track.id) && (
                        <ThumbsDown className="w-4 h-4 text-blue-400 fill-blue-400" />
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
