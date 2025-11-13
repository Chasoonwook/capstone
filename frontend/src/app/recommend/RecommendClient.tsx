"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play, Pause, SkipBack, SkipForward,
  ChevronDown, MoreVertical, Heart, ThumbsDown,
  ListMusic, Upload, VolumeX, Volume1, Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE, authHeaders } from "@/lib/api";
import { usePlayer, Track } from "@/contexts/PlayerContext";
import { useSpotifyStatus } from "@/contexts/SpotifyStatusContext";
import { formatTime } from "./utils/media";
import RecommendationList from "./components/RecommendationList";

// ✅ 경로 수정: 이 파일 기준으로는 "./types"
import type { Song } from "./types";

/* ──────────────────────────────────────────────
   Track 확장: genre를 이 파일에서만 옵션으로 사용
   ──────────────────────────────────────────────*/
type TrackPlus = Track & { genre?: string | null };

/** 사진 바이너리 URL */
const buildPhotoSrc = (photoId?: string | null) =>
  photoId ? `${API_BASE}/api/photos/${encodeURIComponent(String(photoId))}/binary` : null;

/** 서버 응답을 TrackPlus로 정규화 */
const normalizeTrack = (raw: any, idx: number): TrackPlus | null => {
  const title = raw?.title ?? raw?.music_title ?? raw?.name ?? null;
  const artist = raw?.artist ?? raw?.music_artist ?? raw?.singer ?? "Unknown";
  if (!title) return null;

  const db_music_id = Number.isFinite(Number(raw?.music_id))
    ? Number(raw.music_id)
    : Number.isFinite(Number(raw?.id)) // raw.id가 music_id일 수도 있음
    ? Number(raw.id)
    : null;

  const player_id = db_music_id ?? `${title}-${artist}-${idx}`;
  
  const preview = raw?.audio_url ?? raw?.preview_url ?? raw?.previewUrl ?? raw?.stream_url ?? null;
  const audioUrl = preview === "EMPTY" ? null : preview;

  const coverUrl =
    raw?.cover_url ?? raw?.album_image ?? raw?.albumImage ?? raw?.image ?? null;

  let duration: number | null = null;
  if (typeof raw?.duration === "number") duration = raw.duration;
  else if (typeof raw?.length_seconds === "number") duration = raw.length_seconds;
  else if (typeof raw?.preview_duration === "number") duration = raw.preview_duration;
  else if (typeof raw?.duration_ms === "number") duration = raw.duration_ms / 1000;

  const genre: string | null = raw?.genre ?? null;

  const spotify_uri: string | null = raw?.spotify_uri ?? null;
  let spotify_track_id: string | null = raw?.spotify_track_id ?? null;
  if (!spotify_track_id && typeof spotify_uri === "string" && spotify_uri.startsWith("spotify:track:")) {
    spotify_track_id = spotify_uri.split(":").pop() || null;
  }

  // ▲ TrackPlus로 반환하므로 genre 포함 가능
  return {
    id: player_id,
    db_music_id: db_music_id,
    title,
    artist,
    audioUrl,
    coverUrl,
    duration,
    genre,
    spotify_uri,
    spotify_track_id,
    selected_from: raw?.selected_from ?? null,
  };
};

/** 커버/미리듣기/Spotify URI 보강 */
async function prefetchCoversAndUris(list: TrackPlus[]): Promise<TrackPlus[]> {
  if (!list?.length) return list;

  const norm = (s?: string | null) =>
    (s || "").replace(/\s+/g, " ").replace(/[[(（【].*?[)\]）】]/g, "").trim().toLowerCase();

  const pairs = list.map((t) => ({ title: norm(t.title), artist: norm(t.artist) }));

  try {
    const res = await fetch(`${API_BASE}/api/spotify/search/batch`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
    });
    if (!res.ok) return list;

    const j = await res.json();
    type BatchItem = {
      key?: string | null;
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
    const valid = items.filter(
      (it): it is BatchItem & { key: string } => it != null && typeof it.key === "string" && it.key.length > 0
    );
    const keyOf = (t: TrackPlus) => `${norm(t.title)} - ${norm(t.artist)}`;
    const map = new Map(valid.map((it) => [it.key, it]));

    return list.map((t) => {
      const hit = map.get(keyOf(t));
      if (!hit) return t;
      const uri = hit.spotify_uri || (hit.id ? `spotify:track:${hit.id}` : null);
      const hitDurationSec = typeof hit.duration_ms === "number" ? hit.duration_ms / 1000 : null;

      return {
        ...t,                     // ← genre 유지
        coverUrl: hit.albumImage || t.coverUrl || null,
        audioUrl: t.audioUrl || hit.preview_url || null,
        duration: t.duration ?? hitDurationSec,
        spotify_uri: t.spotify_uri || uri || null,
        spotify_track_id: t.spotify_track_id || hit.id || uri?.split(":").pop() || null,
      };
    });
  } catch {
    return list;
  }
}

export default function RecommendClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const player = usePlayer();
  const { status: spotifyStatus } = useSpotifyStatus();
  const isSpotifyConnected = (spotifyStatus?.connected ?? false) && player.isSpotifyReady;

  const photoId = useMemo(() => {
    const id = searchParams.get("photoId") || searchParams.get("photoID") || searchParams.get("id");
    if (id) {
      // URL이 바뀔 때마다 세션 스토리지도 갱신
      const route = `/recommend?photoId=${encodeURIComponent(id)}`;
      try { sessionStorage.setItem("lastPlayerRoute", route); } catch {}
    }
    return id;
  }, [searchParams]);
  
  const analyzedPhotoUrl = useMemo(() => buildPhotoSrc(photoId), [photoId]);
  const [playlist, setPlaylist] = useState<TrackPlus[]>([]);   // ✅ TrackPlus
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [likedTracks, setLikedTracks] = useState<Set<string | number>>(new Set());
  const [dislikedTracks, setDislikedTracks] = useState<Set<string | number>>(new Set());
  const initialLoadDoneRef = useRef<boolean>(false);

  const userNameFallback = useMemo(
    () => (typeof window !== "undefined" ? localStorage.getItem("user_name") || localStorage.getItem("name") : null),
    []
  );
  const playlistTitle = `${userNameFallback || "내"} 플레이리스트`;

  const { setQueueAndPlay, state: playerState } = player;

  useEffect(() => {
    if (photoId == null) {
      setLoading(false);
      setError(null);
      return;
    }

    // 1. URL의 photoId와 현재 플레이어 큐의 소스(key)가 같은지 확인
    const isSameQueueSource = playerState.queueKey === photoId;

    // 1. PlayerContext에 이미 큐가 있는지 확인합니다.
    if (isSameQueueSource && playerState.queue.length > 0) {
      console.log("RecommendClient: Player already has a queue. Skipping fetch & setQueue.");
      // API 호출과 큐 리셋을 건너뜁니다.
      // 현재 컨텍스트 큐를 이 컴포넌트의 UI 목록(playlist)에 동기화만 합니다.
      setPlaylist(playerState.queue as TrackPlus[]); // UI 목록만 동기화
      setLoading(false);
      initialLoadDoneRef.current = true; // 로드 완료로 처리
      return; // 👈 여기서 useEffect 종료
    }

    (async () => {
      setLoading(true);
      setError(null);
      console.log(`RecommendClient: Fetching NEW queue for photoId ${photoId}...`);
      try {
        const url = `${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json();

        let list: TrackPlus[] = [];
        if (data && (data.main_songs || data.sub_songs || data.preferred_songs)) {
          const tag = (arr: any[], tagName: TrackPlus["selected_from"]) =>
            (arr || []).map((r) => ({ ...r, selected_from: tagName }));
          const all = [
            ...tag(data.main_songs, "main"),
            ...tag(data.sub_songs, "sub"),
            ...tag(data.preferred_songs, "preferred"),
          ];
          list = all.map((r, i) => normalizeTrack(r, i)).filter((t): t is TrackPlus => t !== null);
        }

        const enhanced = await prefetchCoversAndUris(list);

        const playable = enhanced.filter(t => 
          (isSpotifyConnected && (t.spotify_uri || t.spotify_track_id)) || // 스포티파이 재생 가능
          (!isSpotifyConnected && t.audioUrl) // 또는 미리듣기 URL이 존재
        );

        if (enhanced.length > 0 && playable.length === 0) {
          console.warn("No playable tracks found (Spotify not connected and no preview_url).");
          setError("추천된 곡들의 미리듣기를 찾을 수 없습니다. Spotify 연동이 필요할 수 있습니다.");
        } else if (enhanced.length > 0 && playable.length < enhanced.length) {
          console.warn(`Filtered out ${enhanced.length - playable.length} unplayable tracks.`);
        }

        setPlaylist(playable);
        setQueueAndPlay(playable, 0, photoId); // 2. photoId를 queueKey로 전달
        initialLoadDoneRef.current = true;
      } catch (e: any) {
        setError(e.message || "추천 목록을 불러오지 못했습니다.");
        setQueueAndPlay([], 0, photoId); // 빈 큐 설정
      } finally {
        setLoading(false);
      }
    })();
  }, [photoId, playerState.queueKey, isSpotifyConnected]);

  const currentTrack = player.state.currentTrack;
  const isPlaying = player.isPlaying;
  const curMs = player.state.curMs;
  const durMs = player.state.durMs;
  const curSec = Math.floor(curMs / 1000);
  const durSec = Math.floor(durMs / 1000);
  const volume = player.volume;

  const handlePlayPause = player.togglePlayPause;
  const handleNext = player.next;
  const handlePrev = player.prev;
  const handleSeek = (value: number[]) => player.seek((value?.[0] ?? 0) * 1000);
  const handleSetVolume = player.setVolume;

  const selectTrack = useCallback(
    (index: number) => {
      if (!playlist || index < 0 || index >= playlist.length) return;
      const trackToPlay = playlist[index];
      player.play(trackToPlay, index, true);
      setShowPlaylist(false);
    },
    [playlist, player]
  );

  // TrackPlus[] → Song[] 변환
  const songPlaylist: Song[] = useMemo(() => {
    if (!playlist) return [];
    return playlist.map((track): Song => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: formatTime(track.duration ?? 0),
      genre: track.genre ?? undefined,
      image: track.coverUrl,
      preview_url: track.audioUrl,
      spotify_uri: track.spotify_uri,
      selected_from: track.selected_from,
    }));
  }, [playlist]);

  // 백엔드로 피드백을 전송
  const sendFeedback = async (feedbackValue: 1 | -1) => {
    
    // parseInt는 null이나 ""를 NaN으로 변환합니다.
    const uid_str = typeof window !== "undefined" ? localStorage.getItem("uid") : null;
    const final_user_id = uid_str ? parseInt(uid_str, 10) : NaN;
    
    const final_photo_id = photoId ? parseInt(photoId, 10) : NaN;
    
    // db_music_id는 이미 number | null 타입일 수 있으므로 Number()를 사용 (null -> 0)
    const final_music_id = (currentTrack && currentTrack.db_music_id) 
      ? Number(currentTrack.db_music_id) 
      : NaN;

    // ✅ 2. 유효성 검사 강화 (NaN이거나 0 이하인 ID는 거부)
    if (!final_user_id || final_user_id <= 0) {
      console.warn("Feedback aborted: Invalid User ID.", uid_str);
      setError("피드백을 보내려면 로그인이 필요합니다.");
      return;
    }
    if (!final_photo_id || final_photo_id <= 0) {
      console.warn("Feedback aborted: Invalid Photo ID.", photoId);
      setError("유효하지 않은 사진 정보입니다.");
      return;
    }
    if (!final_music_id || final_music_id <= 0) {
      console.warn("Feedback aborted: Invalid Music ID.", currentTrack?.db_music_id);
      setError("피드백을 보낼 수 없는 곡입니다.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        } as HeadersInit,
        credentials: "include", // authRequired API는 이 옵션이 필수입니다.
        body: JSON.stringify({
          user_id: final_user_id,
          music_id: final_music_id,
          feedback: feedbackValue, // 1 (좋아요) 또는 -1 (싫어요)
          photo_id: final_photo_id,
        }),
      });

      if (!res.ok) {
        console.warn("Failed to send feedback to server:", res.status);
        setError(`피드백 전송에 실패했습니다. (코드: ${res.status})`);
      } else {
        console.log(`Feedback (value: ${feedbackValue}) successfully sent.`);
        setError(null);
      }
    } catch (e) {
      console.error("Error sending feedback:", e);
      setError("피드백 전송 중 오류가 발생했습니다.");
    }
  };

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
    const isCurrentlyLiked = next.has(currentTrack.id);
    
    if (isCurrentlyLiked) {
      next.delete(currentTrack.id);
    } else {
      next.add(currentTrack.id); // 좋아요 추가

      if (dislikedTracks.has(currentTrack.id)) {
        const d = new Set(dislikedTracks);
        d.delete(currentTrack.id);
        setDislikedTracks(d);
      }
      sendFeedback(1); // 좋아요 피드백 전송
    }
    setLikedTracks(next);
  };

  const toggleDislike = () => {
    if (!currentTrack) return;
    const next = new Set(dislikedTracks);
    const isCurrentlyDisliked = next.has(currentTrack.id);

    if (isCurrentlyDisliked) {
      next.delete(currentTrack.id);
    } else {
      next.add(currentTrack.id);

      if (likedTracks.has(currentTrack.id)) {
        const l = new Set(likedTracks);
        l.delete(currentTrack.id);
        setLikedTracks(l);
      }
      sendFeedback(-1); // 싫어요 피드백 전송
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
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            title="옵션"
          >
            <MoreVertical className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {/* 아트워크(업로드 이미지 우선) */}
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

        {/* 제목/아티스트/출처 */}
        <div className="flex items-start justify-between text-white mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold mb-1 line-clamp-2">
              {currentTrack?.title || (loading ? "불러오는 중..." : "—")}
            </h1>
            <p className="text-base text-white/70 truncate">
              {currentTrack?.artist || "Unknown"}
            </p>
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
            onValueChange={(vals) => handleSeek(vals)}
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

    {/* 재생목록 오버레이 */}
    {showPlaylist && (
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => setShowPlaylist(false)}
      />
    )}

    {/* 재생목록 시트 */}
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

          {!loading && playlist.length > 0 && (
            <RecommendationList
              items={songPlaylist}
              currentId={currentTrack?.id ?? null}
              onClickItem={(track) => selectTrack(playlist.findIndex((t) => t.id === track.id))}
            />
          )}
        </div>
      </div>
    </div>
  </div>
);

}
