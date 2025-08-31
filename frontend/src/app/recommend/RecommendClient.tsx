// src/app/recommend/RecommendClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, SkipBack, SkipForward, X, ChevronLeft, ChevronRight, Music } from "lucide-react";
import { API_BASE } from "@/lib/api";

/** ---------- 타입 ---------- */
type Song = {
  id: number | string;
  title: string;
  artist: string;
  genre: string;
  duration?: string;
  image?: string | null;
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
  const candidates = [
    `${API_BASE}/api/photos/${photoId}/binary`,
    `${API_BASE}/photos/${photoId}/binary`,
  ];
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

  // 추천 가져오기 (by-photo → 실패/대기 시 random 폴백)
  useEffect(() => {
  let mounted = true;

  const fetchRandom = async () => {
    try {
      // 무조건 랜덤 엔드포인트 호출 (캐시 회피용 nocache 추가)
      const r = await fetch(`${API_BASE}/api/recommendations/random?nocache=${Date.now()}`);
      if (!r.ok) {
        console.error("추천 API 실패:", r.status, await safeText(r));
        return;
      }
      const data: any = await r.json();

      const list = Array.isArray(data?.total) ? data.total : [];
      const seen = new Set();
      const dedup = list
        .filter((s: any, i: number) => {
          const id = s.music_id ?? s.id ?? i; // id 없을 때 인덱스로 폴백
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(0, 10);

      const songs: Song[] = dedup.map((it: any, idx: number) => {
        const sec =
          typeof it.duration === "number" ? it.duration :
          typeof it.duration_sec === "number" ? it.duration_sec : 180;
        const mm = Math.floor(sec / 60);
        const ss = String(sec % 60).padStart(2, "0");

        return {
          id: it.music_id ?? it.id ?? idx,
          title: it.title ?? "Unknown Title",
          artist: it.artist ?? "Unknown Artist",
          genre: it.genre ?? it.label ?? "UNKNOWN",
          duration: `${mm}:${ss}`,
          image: uploadedImage ?? "/placeholder.svg",
        };
      });

      if (mounted) {
        setRecommendations(songs);
        setCurrentSong(songs[0] ?? null);
        setDuration(180);
      }
    } catch (e) {
      console.error("추천 불러오기 오류:", e);
    }
  };

  // photoId는 배경이미지 로딩용이고, 추천은 랜덤으로 항상 가능
  fetchRandom();
  return () => {
    mounted = false;
  };
}, [uploadedImage]); // ← 이미지 바뀌면 커버도 업데이트


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

  /** ---------- 뷰 컴포넌트들 ---------- */
  // (A) CD 플레이어 뷰
  const CDPlayerView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative">
        <div className={`relative w-80 h-80 ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "4s" }}>
          <div className="w-full h-full rounded-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 shadow-2xl border-4 border-slate-300 relative">
            <div className="absolute -inset-4 bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 rounded-full opacity-20 blur-xl"></div>
            <div
              className="w-full h-full rounded-full overflow-hidden border-8 border-slate-800 relative z-10 bg-center bg-cover"
              style={{ backgroundImage: `url(${safeImageSrc})` }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-slate-900/90 rounded-full shadow-inner flex items-center justify-center">
                <div className="w-8 h-8 bg-slate-950 rounded-full"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // (B) 인스타그램형 뷰
  const InstagramView = () => (
    <div className="flex-1 flex items-center justify-center w-full h-full">
      <div className="flex items-center justify-between w-full max-w-6xl mx-auto px-8">
        <div className="flex-shrink-0">
          <div className="relative">
            <div
              className="w-80 h-80 rounded-full overflow-hidden border-4 border-white/30 shadow-2xl bg-center bg-cover"
              style={{ backgroundImage: `url(${safeImageSrc})` }}
            />
            <div className="absolute -inset-4 bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 rounded-full opacity-20 blur-xl"></div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center mx-12">
          {currentSong && (
            <>
              <div className="flex flex-col items-center mb-8">
                <div
                  className="mb-5 w-32 h-32 rounded-xl shadow-2xl border border-white/20 bg-center bg-cover"
                  style={{ backgroundImage: `url(${currentSong.image ?? safeImageSrc})` }}
                />
                <div className="text-center">
                  <h2 className="text-5xl font-bold text-white mb-4 text-balance leading-tight">{currentSong.title}</h2>
                  <p className="text-2xl text-slate-300 mb-6 font-medium">{currentSong.artist}</p>
                  <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-8 py-3 text-lg font-semibold rounded-full shadow-lg">
                    {currentSong.genre}
                  </Badge>
                </div>
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

        {recommendations.length > 0 && (
          <div className="flex-shrink-0 w-80">
            <div className="bg-black/30 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-2xl">
              <h3 className="text-xl font-semibold text-white mb-4 text-center">추천 플레이리스트</h3>
              <div className="max-h-96 overflow-y-auto space-y-3">
                {recommendations.slice(0, 6).map((song) => (
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
                    <div
                      className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden mr-3 border border-white/10 bg-center bg-cover"
                      style={{ backgroundImage: `url(${song.image ?? safeImageSrc})` }}
                    />
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
          </div>
        )}
      </div>
    </div>
  );

  // (C) 기본 뷰
  const DefaultView = () => (
    <div className="flex-1 flex justify-center">
      <div className="relative">
        <div className="absolute -inset-4 bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 rounded-2xl opacity-30 blur-xl"></div>
        <div
          className="relative z-10 rounded-2xl shadow-2xl border-2 border-white/20 w-[400px] h-[400px] bg-center bg-cover"
          style={{ backgroundImage: `url(${safeImageSrc})` }}
        />
      </div>
    </div>
  );

  // 공통 플레이어 + 리스트
  const renderPlayerAndPlaylist = () => (
    <>
      {currentSong && (
        <>
          <div className="flex flex-col items-center mb-8">
            <div
              className="mb-4 w-32 h-32 rounded-xl shadow-2xl border border-white/20 bg-center bg-cover"
              style={{ backgroundImage: `url(${currentSong.image ?? safeImageSrc})` }}
            />
            <div className="text-center">
              <h2 className="text-4xl font-bold text-white mb-3 text-balance leading-tight">{currentSong.title}</h2>
              <p className="text-xl text-slate-300 mb-4 font-medium">{currentSong.artist}</p>
              <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-2 text-sm font-semibold rounded-full shadow-lg">
                {currentSong.genre}
              </Badge>
            </div>
          </div>

          <div className="mb-8 w-full max-w-md mx-auto">
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
        </>
      )}

      <div className="flex items-center justify-center space-x-8 mb-8">
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

      {recommendations.length > 0 && (
        <div className="mt-8 w-full max-w-2xl mx-auto">
          <h3 className="text-xl font-semibold text-white mb-4 text-center">추천 음악</h3>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-4 max-h-80 overflow-y-auto border border-white/10">
            <div className="space-y-2">
              {recommendations.map((song) => (
                <div
                  key={song.id}
                  onClick={() => {
                    setCurrentSong(song);
                    setCurrentTime(0);
                  }}
                  className={`flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-white/10 ${
                    currentSong?.id === song.id
                      ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/30"
                      : "hover:scale-[1.02]"
                  }`}
                >
                  <div
                    className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden mr-3 border border-white/10 bg-center bg-cover"
                    style={{ backgroundImage: `url(${song.image ?? safeImageSrc})` }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{song.title}</p>
                    <p className="text-slate-300 text-sm truncate">{song.artist}</p>
                  </div>
                  <div className="flex-shrink-0 ml-3">
                    <Badge variant="secondary" className="bg-white/10 text-slate-300 text-xs px-2 py-1 border-0">
                      {song.genre}
                    </Badge>
                  </div>
                  {currentSong?.id === song.id && (
                    <div className="flex-shrink-0 ml-2">
                      <div className="w-2 h-2 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full animate-pulse"></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );

  const renderCurrentView = () => {
    const views = ["cd", "instagram", "default"] as const;
    switch (views[currentViewIndex]) {
      case "cd":
        return (
          <>
            <CDPlayerView />
            <div className="flex-1 ml-12 h-full flex flex-col justify-center">{renderPlayerAndPlaylist()}</div>
          </>
        );
      case "instagram":
        return <InstagramView />;
      default:
        return (
          <>
            <DefaultView />
            <div className="flex-1 ml-12 h-full flex flex-col justify-center">{renderPlayerAndPlaylist()}</div>
          </>
        );
    }
  };

  const handleClose = () => {
    try {
      router.replace("/");
    } catch (error) {
      console.error("Navigation error:", error);
      window.location.href = "/";
    }
  };

  const handlePrevView = () => setCurrentViewIndex((prev) => (prev - 1 + 3) % 3);
  const handleNextView = () => setCurrentViewIndex((prev) => (prev + 1) % 3);

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-95 flex items-center justify-center">
      <div className="absolute inset-0 bg-cover bg-center blur-md scale-110" style={safeBgStyle} />
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black/50 to-pink-900/30"></div>

      <div className="absolute top-6 right-6 z-10 flex space-x-3">
        <button
          onClick={handleClose}
          className="bg-white/10 backdrop-blur-sm rounded-full p-3 shadow-lg hover:bg-white/20 transition-all duration-200 hover:scale-110 border border-white/20"
          type="button"
        >
          <X className="h-6 w-6 text-white" />
        </button>
      </div>

      <button
        onClick={handlePrevView}
        className="absolute left-6 top-1/2 -translate-y-1/2 z-10 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
        type="button"
      >
        <ChevronLeft className="h-6 w-6 text-white" />
      </button>
      <button
        onClick={handleNextView}
        className="absolute right-6 top-1/2 -translate-y-1/2 z-10 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
        type="button"
      >
        <ChevronRight className="h-6 w-6 text-white" />
      </button>

      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 flex items-center justify-between h-full">
        {renderCurrentView()}
      </div>
    </div>
  );
}
