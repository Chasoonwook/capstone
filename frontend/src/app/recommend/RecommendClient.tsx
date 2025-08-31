"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, SkipBack, SkipForward, X, ChevronLeft, ChevronRight } from "lucide-react";
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
            const id = s.music_id ?? s.id ?? i;
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
    fetchRandom();
    return () => {
      mounted = false;
    };
  }, [uploadedImage]);

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
      {/* ... 기존 코드 동일 ... */}
    </div>
  );

  // (C) 기본 뷰
  const DefaultView = () => (
    <div className="flex-1 flex justify-center">
      {/* ... 기존 코드 동일 ... */}
    </div>
  );

  // 음악 리스트 컨테이너 (공통적으로 항상 노출)
  const MusicListContainer = () => (
    <div className="fixed right-0 top-0 h-full w-[400px] bg-black bg-opacity-70 backdrop-blur-lg shadow-2xl z-50 p-6 flex flex-col">
      <h2 className="text-white font-bold text-2xl mb-5 text-center">추천 음악 리스트</h2>
      <div className="overflow-y-auto flex-1">
        {recommendations?.length > 0 ? (
          recommendations.map((song) => (
            <div
              key={song.id}
              onClick={() => {
                setCurrentSong(song);
                setCurrentTime(0);
              }}
              className={`flex items-center p-3 rounded-xl cursor-pointer mb-2 transition-all duration-200 hover:bg-white/10 ${
                currentSong?.id === song.id
                  ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/30"
                  : ""
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
            </div>
          ))
        ) : (
          <div className="text-center text-slate-400 mt-10">추천 음악이 없습니다.</div>
        )}
      </div>
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
    <div className="fixed inset-0 z-40 bg-black bg-opacity-95 flex items-center justify-center">
      {/* 배경 처리 */}
      <div className="absolute inset-0 bg-cover bg-center blur-md scale-110" style={safeBgStyle} />
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black/50 to-pink-900/30"></div>

      {/* 닫기, 뷰 전환 버튼들 */}
      <div className="absolute top-6 right-[420px] z-50 flex space-x-3">
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
        className="absolute left-6 top-1/2 -translate-y-1/2 z-40 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
        type="button"
      >
        <ChevronLeft className="h-6 w-6 text-white" />
      </button>
      <button
        onClick={handleNextView}
        className="absolute right-[420px] top-1/2 -translate-y-1/2 z-40 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
        type="button"
      >
        <ChevronRight className="h-6 w-6 text-white" />
      </button>

      {/* 메인 View */}
      <div className="relative z-30 w-full max-w-6xl mx-auto px-6 flex items-center justify-between h-full">
        {renderCurrentView()}
      </div>

      {/* 항상 떠있는 추천 음악 리스트 컨테이너 */}
      <MusicListContainer />
    </div>
  );
}
