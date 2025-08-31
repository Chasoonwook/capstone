// src/app/recommend/RecommendClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
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
  duration?: number;
  duration_sec?: number;
};

type ByPhotoResponse = {
  main_songs?: BackendSong[];
  sub_songs?: BackendSong[];
};

/** ---------- 유틸 ---------- */
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isBackendSong(v: unknown): v is BackendSong {
  if (!isRecord(v)) return false;
  // 필수 필드는 없지만, 최소한 문자열/숫자 유형의 일부 키가 있는지 점검
  const { id, music_id, title, artist, label, genre, duration, duration_sec } = v;
  const isOptStrOrNum = (x: unknown) =>
    typeof x === "string" || typeof x === "number" || typeof x === "undefined";
  const isOptNum = (x: unknown) => typeof x === "number" || typeof x === "undefined";

  return (
    isOptStrOrNum(id) &&
    isOptStrOrNum(music_id) &&
    (typeof title === "string" || typeof title === "undefined") &&
    (typeof artist === "string" || typeof artist === "undefined") &&
    (typeof label === "string" || typeof label === "undefined") &&
    (typeof genre === "string" || typeof genre === "undefined") &&
    isOptNum(duration) &&
    isOptNum(duration_sec)
  );
}

function toBackendSongArray(v: unknown): BackendSong[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isBackendSong);
}

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
  const [duration, setDuration] = useState(180);
  const [currentViewIndex, setCurrentViewIndex] = useState(0);

  // 업로드 이미지 URL 조회
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

  // 사진 기반 추천 조회
  useEffect(() => {
    let mounted = true;
    const fetchRecommendationsByPhoto = async () => {
      if (!photoId) return;
      try {
        const r = await fetch(`${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}`);
        if (!r.ok) {
          console.error("추천 API 실패:", r.status, await safeText(r));
          setRecommendations([]);
          setCurrentSong(null);
          return;
        }

        const raw: unknown = await r.json();
        const resp: ByPhotoResponse = isRecord(raw)
          ? {
              main_songs: toBackendSongArray((raw as Record<string, unknown>).main_songs),
              sub_songs: toBackendSongArray((raw as Record<string, unknown>).sub_songs),
            }
          : { main_songs: [], sub_songs: [] };

        const mainSongs = resp.main_songs ?? [];
        const subSongs = resp.sub_songs ?? [];
        const list: BackendSong[] = [...mainSongs, ...subSongs];

        // dedup by music_id/id
        const seen = new Set<string | number>();
        const dedup: BackendSong[] = [];
        list.forEach((s, i) => {
          const id = (s.music_id ?? s.id ?? i) as string | number;
          if (!seen.has(id)) {
            seen.add(id);
            dedup.push(s);
          }
        });

        const songs: Song[] = dedup.map((it, idx) => {
          const sec =
            typeof it.duration === "number"
              ? it.duration
              : typeof it.duration_sec === "number"
              ? it.duration_sec
              : 180;
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
        setRecommendations([]);
        setCurrentSong(null);
      }
    };
    fetchRecommendationsByPhoto();
    return () => {
      mounted = false;
    };
  }, [photoId, uploadedImage]);

  const safeImageSrc = useMemo(() => uploadedImage || "/placeholder.svg", [uploadedImage]);
  const safeBgStyle = useMemo(() => ({ backgroundImage: `url(${safeImageSrc})` }), [safeImageSrc]);

  const MusicListContainer = () => (
    <div className="fixed right-0 top-0 h-full w-[400px] bg-black bg-opacity-70 backdrop-blur-lg shadow-2xl z-50 p-6 flex flex-col">
      <h2 className="text-white font-bold text-2xl mb-5 text-center">추천 음악 리스트</h2>
      <div className="overflow-y-auto flex-1">
        {recommendations.length > 0 ? (
          recommendations.map((song) => (
            <div
              key={song.id}
              onClick={() => setCurrentSong(song)}
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
        return <div>CD Player View (미구현)</div>;
      case "instagram":
        return <div>Instagram View (미구현)</div>;
      default:
        return <div>Default View (미구현)</div>;
    }
  };

  const handleClose = () => {
    try {
      router.replace("/");
    } catch {
      (window as unknown as { location: Location }).location.href = "/";
    }
  };

  const handlePrevView = () => setCurrentViewIndex((prev) => (prev - 1 + 3) % 3);
  const handleNextView = () => setCurrentViewIndex((prev) => (prev + 1) % 3);

  return (
    <div className="fixed inset-0 z-40 bg-black bg-opacity-95 flex items-center justify-center">
      <div className="absolute inset-0 bg-cover bg-center blur-md scale-110" style={safeBgStyle} />
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black/50 to-pink-900/30"></div>

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

      <div className="relative z-30 w-full max-w-6xl mx-auto px-6 flex items-center justify-between h-full">
        {renderCurrentView()}
      </div>

      <MusicListContainer />
    </div>
  );
}
