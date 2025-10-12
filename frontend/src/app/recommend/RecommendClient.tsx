"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play, Pause, SkipBack, SkipForward,
  ChevronDown, MoreVertical, Heart, ThumbsDown, ListMusic, Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";

type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;         // 프리뷰 있을 수도/없을 수도
  coverUrl?: string | null;
  duration?: number | null;         // 초 단위(옵션)
  spotify_track_id?: string | null; // 있으면 Spotify 전체 재생
};

const buildPhotoSrc = (photoId?: string | null) => {
  if (!photoId) return null;
  const id = encodeURIComponent(String(photoId));
  return `${API_BASE}/api/photos/${id}/binary`;
};

// 백엔드 응답 표준화
const normalizeTrack = (raw: any, idx: number): Track | null => {
  const title = raw?.title ?? raw?.music_title ?? raw?.name ?? null;
  const artist = raw?.artist ?? raw?.music_artist ?? raw?.singer ?? "Unknown";
  const preview = raw?.audio_url ?? raw?.preview_url ?? raw?.stream_url ?? null;
  const audioUrl = preview === "EMPTY" ? null : preview;
  const coverUrl = raw?.cover_url ?? raw?.album_image ?? raw?.image ?? null;
  const duration =
    Number(raw?.duration ?? raw?.length_seconds ?? raw?.preview_duration ?? 0) || null;
  const spotify_track_id = raw?.spotify_track_id ?? null;

  if (!title) return null;
  return {
    id: raw?.id ?? raw?.music_id ?? idx,
    title,
    artist,
    audioUrl,
    coverUrl,
    duration,
    spotify_track_id,
  };
};

export default function RecommendClient() {
  const router = useRouter();
  const sp = useSpotifyPlayer(); // { ready, state(ms), playUris, pause, resume, next, prev, seek, ... }

  // URL에서 photoId
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
  const playlistTitle = `${(userNameFallback || "내")} 플레이리스트`;

  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // <audio> 전용 상태
  const [currentTime, setCurrentTime] = useState(0); // 초
  const [duration, setDuration] = useState<number>(0); // 초
  const audioRef = useRef<HTMLAudioElement>(null);

  // Slider 드래그 미리보기(초). null이면 실제 재생 위치 사용
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

  const [showPlaylist, setShowPlaylist] = useState(false);
  const [likedTracks, setLikedTracks] = useState<Set<string | number>>(new Set());
  const [dislikedTracks, setDislikedTracks] = useState<Set<string | number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentTrack = playlist[currentTrackIndex];

  // 복귀용 경로 저장
  useEffect(() => {
    if (typeof window !== "undefined") {
      const route = `${window.location.pathname}${window.location.search}`;
      sessionStorage.setItem("lastPlayerRoute", route);
    }
  }, []);

  // 추천 가져오기
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
          const all = [
            ...(data.main_songs || []),
            ...(data.sub_songs || []),
            ...(data.preferred_songs || []),
          ];
          list = all.map((r, i) => normalizeTrack(r, i)).filter(Boolean) as Track[];
        }
        setPlaylist(list);
        setCurrentTrackIndex(0);
        setSeekPreview(null);
      } catch (e) {
        console.error(e);
        setError("추천 목록을 불러오지 못했습니다.");
        setPlaylist([]);
        setCurrentTrackIndex(0);
        setSeekPreview(null);
      } finally {
        setLoading(false);
      }
    };
    if (photoId !== null) void fetchPlaylist();
  }, [photoId]);

  /** ────────────── <audio> 로딩/진행/종료 ────────────── */
  const loadCurrentTrack = useCallback(
    async (autoplay = false) => {
      const t = currentTrack;
      const audio = audioRef.current;
      setSeekPreview(null);

      if (!t || !audio) return;
      if (!t.audioUrl) {
        // Spotify 전용 트랙이면 <audio>는 비운다
        audio.removeAttribute("src");
        audio.load();
        setCurrentTime(0);
        setDuration(0);
        return;
      }

      setCurrentTime(0);
      audio.src = t.audioUrl;
      audio.load();

      const onLoaded = () => {
        const d = Math.floor(audio.duration || 0);
        setDuration(t.duration ?? d);
      };
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });

      if (autoplay) {
        try {
          await audio.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
        }
      }
    },
    [currentTrack],
  );

  // 곡/인덱스 바뀔 때 로드
  useEffect(() => {
    if (currentTrack) void loadCurrentTrack(isPlaying);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex]);

  // <audio> 이벤트
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnded = () => handleNext();
    const onError = () => {
      console.warn("[audio error]", audio.error, audio.currentSrc || audio.src);
      setError("오디오를 불러오지 못했습니다. (URL/CORS/HTTPS 확인)");
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  /** ────────────── 컨트롤 ────────────── */
  const togglePlay = async () => {
    const t = playlist[currentTrackIndex];
    // Spotify
    if (t?.spotify_track_id) {
      if (isPlaying) {
        await sp.pause();
        setIsPlaying(false);
        return;
      }
      try {
        if (sp.state.duration === 0 || !sp.state.trackUri) {
          // 아직 트랙이 로드 안 된 상태라면 새로 플레이
          await sp.playUris([`spotify:track:${t.spotify_track_id}`]);
        } else {
          await sp.resume();
        }
        setIsPlaying(true);
      } catch (e) {
        console.error(e);
      }
      return;
    }

    // <audio>
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const handlePrevious = () => {
    const t = playlist[currentTrackIndex];
    setSeekPreview(null);
    if (t?.spotify_track_id) {
      sp.prev();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    setCurrentTrackIndex((prev) => (prev === 0 ? Math.max(playlist.length - 1, 0) : prev - 1));
  };

  const handleNext = () => {
    const t = playlist[currentTrackIndex];
    setSeekPreview(null);
    if (t?.spotify_track_id) {
      sp.next();
      return;
    }
    setCurrentTrackIndex((prev) => {
      if (prev < playlist.length - 1) return prev + 1;
      setIsPlaying(false);
      return prev;
    });
  };

  /** Slider 조작 (미리보기 + 커밋 분리) */
  const onSeekPreview = (value: number[]) => {
    const v = value[0];
    setSeekPreview(v);
  };
  const onSeekCommit = async (value: number[]) => {
    const v = value[0];
    setSeekPreview(null);

    const t = playlist[currentTrackIndex];
    if (t?.spotify_track_id) {
      await sp.seek(v * 1000);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = v;
    setCurrentTime(v);
  };

  const selectTrack = async (index: number) => {
    setCurrentTrackIndex(index);
    setSeekPreview(null);
    const t = playlist[index];
    if (t?.spotify_track_id) {
      if (!sp.deviceId || !sp.ready) {
        alert("Spotify 연결 중입니다. (Premium 필요) 잠시 후 다시 시도하세요.");
      } else {
        await sp.playUris([`spotify:track:${t.spotify_track_id}`]);
        setIsPlaying(true);
      }
      setShowPlaylist(false);
      return;
    }
    setShowPlaylist(false);
  };

  // 업로드 트리거만
  const handleUploadClick = () => fileInputRef.current?.click();
  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log("selected file:", file);
    // TODO: 업로드 → /api/photos/analyze → 추천 재호출
  };

  const artUrl = analyzedPhotoUrl || currentTrack?.coverUrl || "/placeholder.svg";

  /** 현재 표시에 사용할 시간/길이 계산 */
  const isSp = !!playlist[currentTrackIndex]?.spotify_track_id;
  const spSec = Math.floor((sp.state.position || 0) / 1000);
  const spDur = Math.floor((sp.state.duration || 0) / 1000);

  const curSec = isSp ? spSec : currentTime;
  const durSec = isSp ? spDur : duration;

  // 드래그 중이면 프리뷰 우선
  const sliderValue = [Math.min(Math.max(seekPreview ?? curSec, 0), Math.max(durSec, 0))];

  const formatTime = (s: number) => {
    const m = Math.floor((s || 0) / 60);
    const t = Math.floor((s || 0) % 60);
    return `${m}:${t.toString().padStart(2, "0")}`;
  };

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

          <div className="ml-auto flex items-center gap-2">
            {!sp.ready && (
              <a
                className="text-xs text-white/70 underline"
                href={`${API_BASE}/api/spotify/login?return=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/")}`}
              >
                Spotify 연결
              </a>
            )}
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
            <img src={artUrl ?? "/placeholder.svg"} alt="analyzed" className="w-full h-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
          </div>

          {/* 곡 정보 */}
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
                onClick={() => {
                  if (!currentTrack) return;
                  const next = new Set(likedTracks);
                  if (next.has(currentTrack.id)) next.delete(currentTrack.id);
                  else next.add(currentTrack.id);
                  setLikedTracks(next);
                  if (dislikedTracks.has(currentTrack.id)) {
                    const d = new Set(dislikedTracks);
                    d.delete(currentTrack.id);
                    setDislikedTracks(d);
                  }
                }}
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
                onClick={() => {
                  if (!currentTrack) return;
                  const next = new Set(dislikedTracks);
                  if (next.has(currentTrack.id)) next.delete(currentTrack.id);
                  else next.add(currentTrack.id);
                  setDislikedTracks(next);
                  if (likedTracks.has(currentTrack.id)) {
                    const l = new Set(likedTracks);
                    l.delete(currentTrack.id);
                    setLikedTracks(l);
                  }
                }}
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

          {/* 진행 바 */}
          <div className="mb-6">
            <Slider
              value={sliderValue}
              max={Math.max(durSec, 0)}
              step={1}
              onValueChange={onSeekPreview}
              onValueCommit={onSeekCommit}
              className="mb-2"
            />
            <div className="flex justify-between text-sm text-white/60">
              <span>{formatTime(sliderValue[0])}</span>
              <span>{`-${formatTime(Math.max((durSec || 0) - sliderValue[0], 0))}`}</span>
            </div>
          </div>

          {/* 하단 컨트롤 */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleUploadClick}
                className="text-white hover:bg-white/10 w-12 h-12"
                title="업로드"
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

            {/* 중앙 버튼: 살짝 작게(원 요청 반영) */}
            <Button
              size="lg"
              onClick={togglePlay}
              className="w-14 h-14 rounded-full bg-white hover:bg-white/90 text-black shadow-lg"
              title={isPlaying ? "일시정지" : "재생"}
            >
              {isPlaying ? (
                <Pause className="w-7 h-7 fill-black" />
              ) : (
                <Play className="w-7 h-7 ml-0.5 fill-black" />
              )}
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
        </div>

        {/* 숨겨진 파일 입력 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        <audio ref={audioRef} preload="metadata" />
      </div>

      {/* 재생목록 시트 */}
      {showPlaylist && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowPlaylist(false)} />
      )}
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
                    src={track.coverUrl || analyzedPhotoUrl || "/placeholder.svg"}
                    alt={track.title}
                    className="w-14 h-14 rounded object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "font-medium truncate",
                        currentTrackIndex === index ? "text-white" : "text-white/90",
                      )}
                    >
                      {track.title}
                    </p>
                    <p className="text-sm text-white/60 truncate">
                      {track.artist}
                      <span className="ml-2 text-xs text-white/50">
                        {track.spotify_track_id ? "Spotify" : (track.audioUrl ? "Preview" : "—")}
                      </span>
                    </p>
                  </div>
                  {currentTrackIndex === index && isPlaying && (
                    <div className="flex-shrink-0" aria-hidden>
                      <div className="flex gap-1 items-end h-4">
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
  );
}
