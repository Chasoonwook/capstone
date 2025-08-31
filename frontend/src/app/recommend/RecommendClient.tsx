// src/app/recommend/RecommendClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, SkipBack, SkipForward, X, ChevronLeft, ChevronRight, Music } from 'lucide-react';
import Image from "next/image";
import { API_BASE } from "@/lib/api";

/** ---------- 타입 ---------- */
type Song = {
  id: number | string;
  title: string;
  artist: string;
  genre: string;
  duration?: string;
  image?: string;
};

type BackendSong = {
  id?: number | string;
  music_id?: number | string;
  title?: string;
  artist?: string;
  label?: string;
  genre?: string;
  genre_code?: string;
  duration?: number | string;
};

/** ---------- 유틸 ---------- */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// 이미지 바이너리 URL 탐색: /api/photos/... -> /photos/...
async function resolveImageUrl(photoId: string): Promise<string | null> {
  const candidates = [`${API_BASE}/api/photos/${photoId}/binary`, `${API_BASE}/photos/${photoId}/binary`];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return url;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export default function RecommendClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const photoId = searchParams.get("photoId");

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(180);
  const [currentViewIndex, setCurrentViewIndex] = useState(0);

  // === 1) 업로드 이미지 URL 탐색 ===
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!photoId) {
        setUploadedImage(null);
        return;
      }
      const url = await resolveImageUrl(photoId);
      if (mounted) setUploadedImage(url ?? "/placeholder.svg");
      if (!url) console.warn("[binary] 이미지 바이너리 404: photoId =", photoId);
    })();
    return () => {
      mounted = false;
    };
  }, [photoId]);

  // === 2) 추천 가져오기 ===
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchByPhoto = async () => {
      if (!photoId) return;

      try {
        const r = await fetch(`${API_BASE}/api/recommendations/by-photo/${photoId}`);
        if (r.status === 202) {
          // 분석 대기중 → 2.5s 후 재시도
          if (mounted) timer = setTimeout(fetchByPhoto, 2500);
          return;
        }
        if (!r.ok) {
          console.error("추천 API 실패:", r.status, await safeText(r));
          return;
        }

        const data: unknown = await r.json();
        const main =
          isRecord(data) && Array.isArray((data as { [k: string]: unknown }).main_songs)
            ? (data as { main_songs: unknown[] }).main_songs
            : [];
        const sub =
          isRecord(data) && Array.isArray((data as { [k: string]: unknown }).sub_songs)
            ? (data as { sub_songs: unknown[] }).sub_songs
            : [];
        const combined: unknown[] = [...main, ...sub];

        const songs: Song[] = combined.map((raw, idx) => {
          const it: BackendSong = isRecord(raw) ? (raw as BackendSong) : {};
          const dur =
            typeof it.duration === "number"
              ? `${Math.floor(it.duration / 60)}:${String(Math.floor(it.duration % 60)).padStart(2, "0")}`
              : typeof it.duration === "string"
              ? it.duration
              : undefined;

          return {
            id: it.music_id ?? it.id ?? idx,
            title: it.title ?? "Unknown Title",
            artist: it.artist ?? "Unknown Artist",
            genre: it.genre ?? it.genre_code ?? it.label ?? "UNKNOWN",
            duration: dur,
            image: "/placeholder.svg",
          };
        });

        if (mounted) {
          setRecommendations(songs);
          setCurrentSong(songs[0] ?? null);
          setDuration(180); // 기본 3분
        }
      } catch (e) {
        console.error("추천 불러오기 오류:", e);
      }
    };

    fetchByPhoto();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [photoId]);

  // === 3) 플레이 타이머 ===
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setCurrentTime((t) => (t + 1 > duration ? duration : t + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration]);

  // === 4) 플레이어 컨트롤 ===
  const togglePlay = () => setIsPlaying((p) => !p);
  const playNextSong = () => {
    if (!currentSong || recommendations.length === 0) return;
    const currentIndex = recommendations.findIndex((song) => song.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % recommendations.length;
    setCurrentSong(recommendations[nextIndex]);
    setCurrentTime(0);
  };
  const playPreviousSong = () => {
    if (!currentSong || recommendations.length === 0) return;
    const currentIndex = recommendations.findIndex((song) => song.id === currentSong.id);
    const prevIndex = currentIndex === 0 ? recommendations.length - 1 : currentIndex - 1;
    setCurrentSong(recommendations[prevIndex]);
    setCurrentTime(0);
  };
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const nextView = () => setCurrentViewIndex((prev) => (prev + 1) % 3);
  const prevView = () => setCurrentViewIndex((prev) => (prev - 1 + 3) % 3);

  // === 5) 이미지 src 안전 처리 ===
  const safeImageSrc = useMemo(() => uploadedImage || "/placeholder.svg", [uploadedImage]);
  const safeBgStyle = useMemo(() => ({ backgroundImage: `url(${safeImageSrc})` }), [safeImageSrc]);

  /** ---------- 공통 플레이리스트 컴포넌트 ---------- */
  const PlaylistPanel = ({ className = "" }: { className?: string }) => (
    <div className={`bg-black/30 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-2xl ${className}`}>
      <h3 className="text-xl font-semibold text-white mb-4 text-center">추천 플레이리스트</h3>
      <div className="max-h-96 overflow-y-auto space-y-3">
        {recommendations.slice(0, 8).map((song) => (
          <div
            key={song.id}
            onClick={() => {
              setCurrentSong(song);
              setCurrentTime(0);
            }}
            className={`flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 ${
              currentSong?.id === song.id
                ? "bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-400/50 shadow-lg"
                : "hover:bg-white/10 hover:scale-[1.02]"
            }`}
          >
            <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg flex items-center justify-center mr-3">
              <Music className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium truncate text-sm">{song.title}</p>
              <p className="text-slate-300 text-xs truncate">{song.artist}</p>
            </div>
            <div className="flex-shrink-0 ml-2">
              <span className="text-slate-400 text-xs">{song.duration || "3:24"}</span>
            </div>
            {currentSong?.id === song.id && (
              <div className="flex-shrink-0 ml-2">
                <div className="w-2 h-2 bg-gradient-to-r from-purple-400 to-pink-500 rounded-full animate-pulse"></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  /** ---------- 뷰 컴포넌트들 ---------- */
  const CDPlayerView = () => (
    <div className="flex items-center justify-between w-full max-w-7xl mx-auto px-8">
      {/* 왼쪽: CD 플레이어 */}
      <div className="flex-shrink-0">
        <div className="relative">
          <div className={`relative w-80 h-80 ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "4s" }}>
            <div className="w-full h-full rounded-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 shadow-2xl border-4 border-slate-300 relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 rounded-full opacity-20 blur-xl"></div>
              <div className="w-full h-full rounded-full overflow-hidden border-8 border-slate-800 relative z-10">
                <Image src={safeImageSrc || "/placeholder.svg"} alt="Current mood" width={320} height={320} className="w-full h-full object-cover" />
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-slate-800 rounded-full shadow-inner flex items-center justify-center">
                  <div className="w-8 h-8 bg-slate-900 rounded-full"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 중앙: 플레이어 컨트롤 */}
      <div className="flex-1 flex flex-col items-center justify-center mx-12">
        {currentSong && (
          <>
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold text-white mb-3 text-balance leading-tight">{currentSong.title}</h2>
              <p className="text-xl text-slate-300 mb-4 font-medium">{currentSong.artist}</p>
              <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-2 text-sm font-semibold rounded-full shadow-lg">
                {currentSong.genre}
              </Badge>
            </div>

            <div className="w-full max-w-md mb-8">
              <div className="flex items-center justify-between text-slate-300 text-sm mb-3 font-medium">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="w-full bg-slate-700/50 rounded-full h-2 backdrop-blur-sm">
                <div
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full shadow-lg transition-all duration-300 ease-out"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center space-x-8">
              <Button variant="ghost" size="lg" onClick={playPreviousSong} className="text-white hover:bg-white/10 rounded-full p-4 transition-all duration-200 hover:scale-110">
                <SkipBack className="h-6 w-6" />
              </Button>

              <Button
                variant="ghost"
                size="lg"
                onClick={togglePlay}
                className="text-white rounded-full p-6 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-xl transition-all duration-200 hover:scale-105"
              >
                {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 ml-1" />}
              </Button>

              <Button variant="ghost" size="lg" onClick={playNextSong} className="text-white hover:bg-white/10 rounded-full p-4 transition-all duration-200 hover:scale-110">
                <SkipForward className="h-6 w-6" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* 오른쪽: 플레이리스트 */}
      {recommendations.length > 0 && (
        <div className="flex-shrink-0 w-80">
          <PlaylistPanel />
        </div>
      )}
    </div>
  );

  const InstagramView = () => (
    <div className="flex items-center justify-between w-full max-w-7xl mx-auto px-8">
      {/* 왼쪽: 사진 */}
      <div className="flex-shrink-0">
        <div className="relative">
          <div className="w-80 h-80 rounded-full overflow-hidden border-4 border-white/30 shadow-2xl">
            <Image src={safeImageSrc || "/placeholder.svg"} alt="Uploaded photo" width={320} height={320} className="w-full h-full object-cover" />
          </div>
          <div className="absolute -inset-4 bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 rounded-full opacity-20 blur-xl"></div>
        </div>
      </div>

      {/* 중앙: 플레이어 컨트롤 */}
      <div className="flex-1 flex flex-col items-center justify-center mx-12">
        {currentSong && (
          <>
            <div className="text-center mb-8">
              <h2 className="text-5xl font-bold text-white mb-4 text-balance leading-tight">{currentSong.title}</h2>
              <p className="text-2xl text-slate-300 mb-6 font-medium">{currentSong.artist}</p>
              <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-8 py-3 text-lg font-semibold rounded-full shadow-lg">
                {currentSong.genre}
              </Badge>
            </div>

            <div className="w-full max-w-md mb-8">
              <div className="flex items-center justify-between text-slate-300 text-lg mb-4 font-medium">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="w-full bg-slate-700/50 rounded-full h-3 backdrop-blur-sm">
                <div
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full shadow-lg transition-all duration-300 ease-out"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center space-x-10">
              <Button variant="ghost" size="lg" onClick={playPreviousSong} className="text-white hover:bg-white/10 rounded-full p-5 transition-all duration-200 hover:scale-110">
                <SkipBack className="h-8 w-8" />
              </Button>

              <Button
                variant="ghost"
                size="lg"
                onClick={togglePlay}
                className="text-white rounded-full p-8 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-xl transition-all duration-200 hover:scale-105"
              >
                {isPlaying ? <Pause className="h-10 w-10" /> : <Play className="h-10 w-10 ml-1" />}
              </Button>

              <Button variant="ghost" size="lg" onClick={playNextSong} className="text-white hover:bg-white/10 rounded-full p-5 transition-all duration-200 hover:scale-110">
                <SkipForward className="h-8 w-8" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* 오른쪽: 플레이리스트 */}
      {recommendations.length > 0 && (
        <div className="flex-shrink-0 w-80">
          <PlaylistPanel />
        </div>
      )}
    </div>
  );

  const DefaultView = () => (
    <div className="flex items-center justify-between w-full max-w-7xl mx-auto px-8">
      {/* 왼쪽: 기본 이미지 */}
      <div className="flex-shrink-0">
        <div className="relative">
          <div className="absolute -inset-4 bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 rounded-2xl opacity-30 blur-xl"></div>
          <Image
            src={safeImageSrc || "/placeholder.svg"}
            alt="Current mood"
            width={400}
            height={400}
            className="relative z-10 rounded-2xl shadow-2xl object-cover border-2 border-white/20"
          />
        </div>
      </div>

      {/* 중앙: 플레이어 컨트롤 */}
      <div className="flex-1 flex flex-col items-center justify-center mx-12">
        {currentSong && (
          <>
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold text-white mb-3 text-balance leading-tight">{currentSong.title}</h2>
              <p className="text-xl text-slate-300 mb-4 font-medium">{currentSong.artist}</p>
              <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-2 text-sm font-semibold rounded-full shadow-lg">
                {currentSong.genre}
              </Badge>
            </div>

            <div className="w-full max-w-md mb-8">
              <div className="flex items-center justify-between text-slate-300 text-sm mb-3 font-medium">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="w-full bg-slate-700/50 rounded-full h-2 backdrop-blur-sm">
                <div
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full shadow-lg transition-all duration-300 ease-out"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center space-x-8">
              <Button variant="ghost" size="lg" onClick={playPreviousSong} className="text-white hover:bg-white/10 rounded-full p-4 transition-all duration-200 hover:scale-110">
                <SkipBack className="h-6 w-6" />
              </Button>

              <Button
                variant="ghost"
                size="lg"
                onClick={togglePlay}
                className="text-white rounded-full p-6 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-xl transition-all duration-200 hover:scale-105"
              >
                {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 ml-1" />}
              </Button>

              <Button variant="ghost" size="lg" onClick={playNextSong} className="text-white hover:bg-white/10 rounded-full p-4 transition-all duration-200 hover:scale-110">
                <SkipForward className="h-6 w-6" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* 오른쪽: 플레이리스트 */}
      {recommendations.length > 0 && (
        <div className="flex-shrink-0 w-80">
          <PlaylistPanel />
        </div>
      )}
    </div>
  );

  const renderCurrentView = () => {
    const views = ["cd", "instagram", "default"] as const;
    switch (views[currentViewIndex]) {
      case "cd":
        return <CDPlayerView />;
      case "instagram":
        return <InstagramView />;
      default:
        return <DefaultView />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-95 flex items-center justify-center">
      <div className="absolute inset-0 bg-cover bg-center blur-md scale-110" style={safeBgStyle} />
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black/50 to-pink-900/30"></div>

      <div className="absolute top-6 right-6 z-10 flex space-x-3">
        <button
          onClick={() => router.replace("/")}
          className="bg-white/10 backdrop-blur-sm rounded-full p-3 shadow-lg hover:bg-white/20 transition-all duration-200 hover:scale-110 border border-white/20"
        >
          <X className="h-6 w-6 text-white" />
        </button>
      </div>

      <button
        onClick={prevView}
        className="absolute left-6 top-1/2 -translate-y-1/2 z-10 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
      >
        <ChevronLeft className="h-6 w-6 text-white" />
      </button>
      <button
        onClick={nextView}
        className="absolute right-6 top-1/2 -translate-y-1/2 z-10 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
      >
        <ChevronRight className="h-6 w-6 text-white" />
      </button>

      <div className="relative z-10 w-full h-full flex items-center justify-center">
        {renderCurrentView()}
      </div>
    </div>
  );
}