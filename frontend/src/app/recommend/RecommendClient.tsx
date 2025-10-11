"use client";

import { useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";

type Track = {
  id: string | number;
  title: string;
  artist: string;
  album?: string;
  duration: number;       // seconds
  coverUrl?: string;
  previewUrl?: string;    // 30s preview (spotify) or mp3 url
};

type Props = {
  photoId?: string | null;
  userName?: string | null;
};

export default function RecommendClient({ photoId, userName }: Props) {
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [liked, setLiked] = useState<Set<string | number>>(new Set());

  const audioRef = useRef<HTMLAudioElement>(null);
  const currentTrack = playlist[currentTrackIndex];

  /* 1) 추천 목록 불러오기 */
  useEffect(() => {
    if (!photoId) return;

    const fetchRecs = async () => {
      try {
        // A. /api/recommendations/:photoId → 실패 시 B
        let res = await fetch(`${API_BASE}/api/recommendations/${photoId}`, {
          credentials: "include",
        });
        if (!res.ok) {
          res = await fetch(
            `${API_BASE}/api/recommendations?photoId=${encodeURIComponent(photoId)}`,
            { credentials: "include" }
          );
        }
        const data = await res.json();
        const items = normalizeToTracks(data);
        if (!items.length) throw new Error("no tracks");

        setPlaylist(items);
        setCurrentTrackIndex(0);
        setCurrentTime(0);

        // 돌아올 때 이 화면을 쉽게 복귀하도록 저장
        try {
          sessionStorage.setItem("lastPlayerRoute", `/recommend?photoId=${photoId}`);
        } catch {}
      } catch (e) {
        console.error("[recommendations] load failed:", e);
        setPlaylist([]);
      }
    };

    fetchRecs();
  }, [photoId]);

  /* 2) 진행시간/종료 핸들링 */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnded = () => handleNext();

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [currentTrackIndex, playlist.length]);

  /* 3) 트랙 변경 시 소스 세팅 (미리듣기 없으면 검색 보완) */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const ensure = async () => {
      let url = currentTrack.previewUrl;
      if (!url) {
        url = await findPreviewUrl(`${currentTrack.title} ${currentTrack.artist}`);
        if (url) {
          setPlaylist((prev) => {
            const next = [...prev];
            next[currentTrackIndex] = { ...next[currentTrackIndex], previewUrl: url };
            return next;
          });
        }
      }
      audio.src = url || "";
      if (isPlaying && url) {
        try {
          await audio.play();
        } catch (e) {
          console.warn("autoplay blocked:", e);
        }
      } else {
        audio.pause();
      }
    };

    ensure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex, isPlaying, currentTrack?.previewUrl]);

  /* controls */
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (!audio.src) {
      const url =
        currentTrack?.previewUrl ||
        (await findPreviewUrl(`${currentTrack?.title} ${currentTrack?.artist}`));
      if (url) audio.src = url;
    }
    try {
      await audio.play();
      setIsPlaying(true);
    } catch (e) {
      console.warn("play failed:", e);
      setIsPlaying(false);
    }
  };

  const handlePrevious = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const i = currentTrackIndex === 0 ? playlist.length - 1 : currentTrackIndex - 1;
    setCurrentTrackIndex(i);
    setCurrentTime(0);
  };

  const handleNext = () => {
    if (currentTrackIndex < playlist.length - 1) {
      setCurrentTrackIndex(currentTrackIndex + 1);
      setCurrentTime(0);
    } else {
      setIsPlaying(false);
    }
  };

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value[0];
    setCurrentTime(value[0]);
  };

  const selectTrack = (index: number) => {
    setCurrentTrackIndex(index);
    setCurrentTime(0);
    setShowPlaylist(false);
    setIsPlaying(true);
  };

  /* helpers */
  function formatTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function findPreviewUrl(q: string): Promise<string | undefined> {
    try {
      const r = await fetch(
        `${API_BASE}/api/spotify/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
        { credentials: "include" }
      );
      if (!r.ok) return;
      const j = await r.json();
      const item = j?.tracks?.items?.[0] || j?.items?.[0] || j?.results?.[0];
      return item?.preview_url || item?.audio_preview_url;
    } catch (e) {
      console.warn("preview search failed:", e);
    }
  }

  function normalizeToTracks(data: any): Track[] {
    // {tracks:[...]}/{recommendations:[...]}/[...] 다양한 형태를 흡수
    const arr: any[] = Array.isArray(data) ? data : data?.tracks || data?.recommendations || [];
    return arr
      .map((it: any, idx: number): Track => {
        const artist =
          it.artist ||
          (Array.isArray(it.artists) ? it.artists.map((a: any) => a?.name).filter(Boolean).join(", ") : it.singer) ||
          it.artist_name ||
          "Unknown";
        const title = it.title || it.name || it.track_name || "Unknown";
        const durationSec =
          typeof it.duration === "number"
            ? it.duration
            : it.duration_ms
            ? Math.round(it.duration_ms / 1000)
            : 30;

        const cover =
          it.coverUrl ||
          it.image ||
          it.album?.images?.[0]?.url ||
          it.albumImage ||
          "/placeholder.svg";

        const preview =
          it.previewUrl || it.preview_url || it.audioUrl || it.audio_preview_url;

        return {
          id: it.id ?? idx,
          title,
          artist,
          album: it.album?.name || it.album || "",
          duration: durationSec,
          coverUrl: cover,
          previewUrl: preview,
        };
      })
      .filter((t) => t.title && t.artist);
  }

  /* UI */
  return (
    <div className="min-h-screen bg-black text-white">
      {/* 상단 헤더 */}
      <div className="px-4 pt-3 flex items-center justify-between">
        <button className="p-2" onClick={() => history.back()} aria-label="뒤로">
          <ChevronDown className="w-6 h-6" />
        </button>
        <div className="text-sm opacity-80 truncate">
          {userName ? `${userName} 플레이리스트` : "추천 플레이리스트"}
        </div>
        <button className="p-2" aria-label="메뉴">
          <MoreVertical className="w-6 h-6" />
        </button>
      </div>

      {/* 커버 */}
      <div className="px-4 mt-3">
        <div className="aspect-square w-full rounded-xl overflow-hidden bg-neutral-900">
          {currentTrack?.coverUrl ? (
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack?.title || "cover"}
              className="w-full h-full object-cover"
            />
          ) : null}
        </div>
      </div>

      {/* 제목/아티스트 */}
      <div className="px-5 mt-6 flex items-start justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{currentTrack?.title || "—"}</h1>
          <p className="text-white/70 truncate">{currentTrack?.artist || "—"}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            className={cn("text-white hover:bg-white/10", liked.has(currentTrack?.id ?? -1) && "text-red-500")}
            onClick={() => {
              const id = currentTrack?.id;
              if (id == null) return;
              setLiked((old) => {
                const n = new Set(old);
                n.has(id) ? n.delete(id) : n.add(id);
                return n;
              });
            }}
            aria-label="좋아요"
          >
            <Heart className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {/* 시크바 */}
      <div className="px-5 mt-4">
        <Slider
          value={[currentTime]}
          max={currentTrack?.duration || 30}
          step={1}
          onValueChange={handleSeek}
          className="mb-2"
        />
        <div className="flex justify-between text-xs text-white/60">
          <span>{formatTime(currentTime)}</span>
          <span>-{formatTime((currentTrack?.duration || 30) - currentTime)}</span>
        </div>
      </div>

      {/* 컨트롤 */}
      <div className="px-5 mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowPlaylist(true)}
          className="text-white hover:bg-white/10"
          aria-label="재생목록"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </Button>

        <div className="flex items-center gap-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrevious}
            className="text-white hover:bg-white/10"
            aria-label="이전"
          >
            <SkipBack className="w-7 h-7 fill-white" />
          </Button>
          <Button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-white text-black hover:bg-white/90"
            aria-label="재생/일시정지"
          >
            {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 translate-x-[2px]" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNext}
            className="text-white hover:bg-white/10"
            aria-label="다음"
          >
            <SkipForward className="w-7 h-7 fill-white" />
          </Button>
        </div>

        <div className="w-10" />
      </div>

      {/* 재생목록 모달 */}
      {showPlaylist && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowPlaylist(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-neutral-900">
            <div className="p-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">추천 재생목록</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPlaylist(false)}
                className="text-white hover:bg-white/10"
                aria-label="닫기"
              >
                <X className="w-6 h-6" />
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 pb-6">
              {playlist.map((t, i) => (
                <button
                  key={`${t.id}-${i}`}
                  onClick={() => selectTrack(i)}
                  className={cn(
                    "w-full flex items-center gap-4 p-3 rounded-xl text-left hover:bg-white/5",
                    i === currentTrackIndex && "bg-white/10",
                  )}
                >
                  <img
                    src={t.coverUrl || "/placeholder.svg"}
                    alt={t.title}
                    className="w-12 h-12 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate font-medium", i === currentTrackIndex ? "text-white" : "text-white/90")}>
                      {t.title}
                    </p>
                    <p className="text-sm text-white/60 truncate">{t.artist}</p>
                  </div>
                </button>
              ))}
              {!playlist.length && (
                <div className="py-10 text-center text-white/60">추천 곡을 불러오지 못했습니다.</div>
              )}
            </div>
          </div>
        </>
      )}

      <audio ref={audioRef} />
    </div>
  );
}
