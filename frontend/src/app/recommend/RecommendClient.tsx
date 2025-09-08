// src/app/recommend/RecommendClient.tsx
"use client";

import Image from "next/image";
import type React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play, Pause, SkipBack, SkipForward, X, ChevronLeft, ChevronRight, RotateCcw
} from "lucide-react";
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
  music_id?: number | string;
  id?: number | string;
  title?: string;
  artist?: string;
  label?: string;
  genre?: string;
  duration?: number;
  duration_sec?: number;
};

type ByPhotoResponse = {
  main_mood?: string | null;
  sub_mood?: string | null;
  main_songs?: BackendSong[];
  sub_songs?: BackendSong[];
  preferred_songs?: BackendSong[];
  preferred_genres?: string[];
};

/** ---------- 유틸 ---------- */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isBackendSong = (v: unknown): v is BackendSong => {
  if (!isRecord(v)) return false;
  const { music_id, id, title, artist, label, genre, duration, duration_sec } = v as Record<string, unknown>;
  const isOptStr = (x: unknown) => typeof x === "string" || typeof x === "undefined";
  const isOptStrOrNum = (x: unknown) => typeof x === "string" || typeof x === "number" || typeof x === "undefined";
  const isOptNum = (x: unknown) => typeof x === "number" || typeof x === "undefined";
  return (
    isOptStrOrNum(music_id) &&
    isOptStrOrNum(id) &&
    isOptStr(title) &&
    isOptStr(artist) &&
    isOptStr(label) &&
    isOptStr(genre) &&
    isOptNum(duration) &&
    isOptNum(duration_sec)
  );
};

const toBackendSongArray = (v: unknown): BackendSong[] => (Array.isArray(v) ? v.filter(isBackendSong) : []);

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function parseDurationToSec(d?: string): number {
  if (!d) return 180;
  const m = /^(\d+):(\d{2})$/.exec(d);
  if (!m) return 180;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  if (Number.isNaN(mins) || Number.isNaN(secs)) return 180;
  return mins * 60 + secs;
}

// 업로드 이미지 바이너리 URL 탐색
async function resolveImageUrl(photoId: string): Promise<string | null> {
  const candidates = [`${API_BASE}/api/photos/${photoId}/binary`, `${API_BASE}/photos/${photoId}/binary`];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return url;
    } catch {}
  }
  return null;
}

/* =======================  Spotify 앨범 커버  ======================= */
type SpotifyImage = { url: string; height: number; width: number };
type SpotifyTrackItem = { id: string; name: string; album: { id?: string; name?: string; images: SpotifyImage[] } };
type SpotifySearchResponse = { items: SpotifyTrackItem[]; total: number };

const isSpotifyImage = (v: unknown): v is SpotifyImage =>
  isRecord(v) && typeof v.url === "string" && typeof v.height === "number" && typeof v.width === "number";

const isSpotifyImageArray = (v: unknown): v is SpotifyImage[] =>
  Array.isArray(v) && v.every(isSpotifyImage);

const isSpotifyTrackItem = (v: unknown): v is SpotifyTrackItem =>
  isRecord(v) &&
  typeof v.id === "string" &&
  typeof v.name === "string" &&
  isRecord(v.album ?? {}) &&
  (isSpotifyImageArray((v.album as Record<string, unknown>).images) ||
    Array.isArray((v.album as Record<string, unknown>).images));

const getItemsArray = (json: unknown): SpotifyTrackItem[] => {
  if (!isRecord(json)) return [];
  if (Array.isArray(json.items) && json.items.every(isSpotifyTrackItem)) return json.items as SpotifyTrackItem[];
  if (isRecord(json.tracks) && Array.isArray(json.tracks.items) && (json.tracks.items as unknown[]).every(isSpotifyTrackItem))
    return json.tracks.items as SpotifyTrackItem[];
  return [];
};

function extractSpotifyImage(json: unknown): string | null {
  const items = getItemsArray(json);
  for (const it of items) {
    const imgs = Array.isArray(it.album.images) ? it.album.images : [];
    const url = imgs?.[1]?.url || imgs?.[0]?.url || imgs?.[2]?.url || null;
    if (url) return url;
  }
  return null;
}

const coverCache = new Map<string, string | null>();
const songKey = (title?: string, artist?: string) =>
  `${(title ?? "").trim().toLowerCase()}|${(artist ?? "").trim().toLowerCase()}`;

async function findAlbumCover(title?: string, artist?: string, signal?: AbortSignal): Promise<string | null> {
  const key = songKey(title, artist);
  if (!key.replace(/\|/g, "")) return null;
  if (coverCache.has(key)) return coverCache.get(key) ?? null;

  const term = [title ?? "", artist ?? ""].join(" ").trim();
  if (!term) { coverCache.set(key, null); return null; }

  try {
    const url = `${API_BASE}/api/spotify/search?query=${encodeURIComponent(term)}&limit=1`;
    const r = await fetch(url, { signal });
    if (!r.ok) { coverCache.set(key, null); return null; }
    const json = (await r.json()) as SpotifySearchResponse | { error?: unknown } | unknown;
    if (isRecord(json) && "error" in json) { coverCache.set(key, null); return null; }
    const img = extractSpotifyImage(json);
    coverCache.set(key, img ?? null);
    return img ?? null;
  } catch {
    coverCache.set(key, null);
    return null;
  }
}

const isPlaceholder = (img?: string | null, placeholder?: string | null) =>
  !img || !img.length || img === placeholder || img.endsWith("/placeholder.svg");

/** ---- AbortError 타입가드 (ESLint any 방지) ---- */
function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const maybe = err as Record<string, unknown>;
  return typeof maybe.name === "string" && maybe.name === "AbortError";
}

/* =======================  컴포넌트  ======================= */

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

  // 기본 뷰를 '사진 플레이어'로
  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const views = ["photo", "cd", "instagram", "default"] as const;

  const [isRefreshing, setIsRefreshing] = useState(false);

  // 가로/세로 판별
  const [isLandscape, setIsLandscape] = useState<boolean | null>(null);

  /** 1) 업로드 이미지 URL */
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!photoId) { setUploadedImage(null); return; }
      const url = await resolveImageUrl(photoId);
      if (mounted) setUploadedImage(url ?? "/placeholder.svg");
    })();
    return () => { mounted = false; };
  }, [photoId]);

  // 원본의 가로/세로 비율 판별 (여백 없이 맞추기 위함)
  useEffect(() => {
    if (!uploadedImage) { setIsLandscape(null); return; }
    const img = new window.Image();
    img.src = uploadedImage;
    img.onload = () => {
      setIsLandscape(img.naturalWidth > img.naturalHeight);
    };
  }, [uploadedImage]);

  /** 전역 회전 키프레임 (CD 뷰 전용) */
  const injectedSpinCSS = useRef(false);
  useEffect(() => {
    if (injectedSpinCSS.current) return;
    const id = "cd-spin-style";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @keyframes cdSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .cd-spin { animation-name: cdSpin; animation-timing-function: linear; animation-iteration-count: infinite;
          will-change: transform; transform: translateZ(0); backface-visibility: hidden; contain: paint; pointer-events: none; }
        @media (prefers-reduced-motion: reduce) { .cd-spin { animation: none !important; } }
      `;
      document.head.appendChild(style);
    }
    injectedSpinCSS.current = true;
  }, []);

  const SPIN_MS = 8000;
  const spinDynamic: React.CSSProperties = useMemo(
    () => ({ animationDuration: `${SPIN_MS}ms`, animationPlayState: isPlaying ? "running" : "paused" }),
    [isPlaying]
  );

  /** 2) 추천 불러오기 (공용) */
  const fetchRecommendations = useCallback(
    async (signal?: AbortSignal) => {
      if (!photoId) { setRecommendations([]); setCurrentSong(null); return; }

      const hydrateCovers = async (base: Song[], placeholder: string | null) => {
        const out = [...base];
        setRecommendations(out);

        const targets = out.map((s, idx) => ({ s, idx })).filter(({ s }) => isPlaceholder(s.image, placeholder));
        let cursor = 0;
        const worker = async () => {
          while (cursor < targets.length) {
            const i = cursor++;
            const { s, idx } = targets[i];
            const img = await findAlbumCover(s.title, s.artist, signal);
            if (img) {
              out[idx] = { ...s, image: img };
              setRecommendations((prev) => {
                const next = [...prev];
                const pos = next.findIndex((x) => x.id === out[idx].id);
                if (pos >= 0) next[pos] = out[idx];
                return next;
              });
              setCurrentSong((prev) => (prev && prev.id === out[idx].id ? out[idx] : prev));
            }
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        return out;
      };

      try {
        const r = await fetch(`${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}?debug=1`, { signal });
        if (!r.ok) { console.error("[by-photo] 실패:", r.status, await r.text()); setRecommendations([]); setCurrentSong(null); return; }

        const raw: unknown = await r.json();
        const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

        const data: ByPhotoResponse = obj
          ? {
              main_mood: typeof obj["main_mood"] === "string" ? (obj["main_mood"] as string) : null,
              sub_mood: typeof obj["sub_mood"] === "string" ? (obj["sub_mood"] as string) : null,
              main_songs: toBackendSongArray(obj["main_songs"]),
              sub_songs: toBackendSongArray(obj["sub_songs"]),
              preferred_songs: toBackendSongArray(obj["preferred_songs"]),
            }
          : { main_songs: [], sub_songs: [], preferred_songs: [] };

        const merged: BackendSong[] = [
          ...(data.main_songs ?? []),
          ...(data.preferred_songs ?? []),
          ...(data.sub_songs ?? []),
        ];

        const seen = new Set<string | number>();
        const dedup: BackendSong[] = [];
        merged.forEach((s, i) => {
          const id = (s.music_id ?? s.id ?? i) as string | number;
          if (!seen.has(id)) { seen.add(id); dedup.push(s); }
        });

        const baseSongs: Song[] = dedup.map((it, idx) => {
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
            image: null,
          };
        });

        setRecommendations(baseSongs);
        const first = baseSongs[0] ?? null;
        setCurrentSong(first);
        setCurrentTime(0);
        setIsPlaying(false);
        setDuration(parseDurationToSec(first?.duration));

        await hydrateCovers(baseSongs, null);
      } catch (e: unknown) {
        if (isAbortError(e)) return;
        console.error("추천 불러오기 오류:", e);
        setRecommendations([]); setCurrentSong(null);
      }
    },
    [photoId]
  );

  /** 첫 로드 */
  useEffect(() => {
    const abort = new AbortController();
    (async () => { await fetchRecommendations(abort.signal); })();
    return () => { abort.abort(); };
  }, [fetchRecommendations]);

  /** 타이머 */
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setCurrentTime((t) => (t + 1 > duration ? duration : t + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration]);

  /** 컨트롤 */
  const togglePlay = () => setIsPlaying((p) => !p);

  const playNextSong = () => {
    if (!currentSong || recommendations.length === 0) return;
    const currentIndex = recommendations.findIndex((song) => song.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % recommendations.length;
    const next = recommendations[nextIndex];
    setCurrentSong(next);
    setCurrentTime(0);
    setDuration(parseDurationToSec(next.duration));
    setIsPlaying(true);
  };

  const playPreviousSong = () => {
    if (!currentSong || recommendations.length === 0) return;
    const currentIndex = recommendations.findIndex((song) => song.id === currentSong.id);
    const prevIndex = currentIndex === 0 ? recommendations.length - 1 : currentIndex - 1;
    const prev = recommendations[prevIndex];
    setCurrentSong(prev);
    setCurrentTime(0);
    setDuration(parseDurationToSec(prev.duration));
    setIsPlaying(true);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (Number.isFinite(val)) setCurrentTime(Math.min(Math.max(val, 0), duration));
  };

  /** 배경 이미지 */
  const safeImageSrc = useMemo(() => uploadedImage || "/placeholder.svg", [uploadedImage]);
  const safeBgStyle = useMemo(() => ({ backgroundImage: `url(${safeImageSrc})` }), [safeImageSrc]);

  /** 새로고침 */
  const handleRefresh = async () => {
    if (isRefreshing) return;
    try {
      setIsRefreshing(true);
      setIsPlaying(false);
      setCurrentTime(0);
      await fetchRecommendations();
    } finally {
      setIsRefreshing(false);
    }
  };

  /** ----- 공통 Right Pane (곡정보/컨트롤/플레이리스트) ----- */
  const RightPane = () => (
    <div className="flex flex-col justify-center flex-1 h-full ml-8">
      {/* Song Info & Controls */}
      <div className="flex flex-col items-center mb-8">
        <div
          className="w-24 h-24 rounded-lg overflow-hidden mb-4 bg-center bg-cover border border-white/20"
          style={{ backgroundImage: `url(${currentSong?.image ?? safeImageSrc})` }}
        />
        <div className="text-center mb-4">
          <h3 className="text-white text-2xl font-semibold mb-1">{currentSong?.title ?? "—"}</h3>
          <p className="text-slate-300 text-lg mb-3">{currentSong?.artist ?? "—"}</p>
          {currentSong?.genre && (
            <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 px-4 py-1">
              {currentSong.genre}
            </Badge>
          )}
        </div>

        <div className="w-full max-w-md mb-6">
          <div className="flex justify-between text-slate-300 text-sm mb-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            onChange={handleSeek}
            className="w-full accent-purple-500"
          />
        </div>

        <div className="flex items-center space-x-6">
          <Button size="icon" variant="ghost" className="rounded-full bg-white/10 hover:bg-white/20 w-12 h-12"
                  onClick={playPreviousSong} aria-label="previous">
            <SkipBack className="h-5 w-5 text-white" />
          </Button>

          <Button size="icon"
                  className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 w-16 h-16"
                  onClick={togglePlay} aria-label={isPlaying ? "pause" : "play"}>
            {isPlaying ? <Pause className="h-7 w-7 text-white" /> : <Play className="h-7 w-7 text-white" />}
          </Button>

          <Button size="icon" variant="ghost" className="rounded-full bg-white/10 hover:bg-white/20 w-12 h-12"
                  onClick={playNextSong} aria-label="next">
            <SkipForward className="h-5 w-5 text-white" />
          </Button>
        </div>
      </div>

      {/* Playlist */}
      <div className="flex-1 bg-black/30 backdrop-blur-sm rounded-2xl p-4 max-h-80">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-lg">추천 음악</h2>
          <Button
            variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing}
            className="text-slate-200 hover:bg-white/10 border border-white/10"
            aria-label="refresh recommendations" title="추천 다시 받기"
          >
            <RotateCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="ml-2 text-xs">{isRefreshing ? "새로고침 중…" : "새로고침"}</span>
          </Button>
        </div>

        <div className="overflow-y-auto h-full">
          {recommendations.length > 0 ? (
            <div className="space-y-2">
              {recommendations.map((song) => (
                <div
                  key={song.id}
                  onClick={() => {
                    setCurrentSong(song);
                    setCurrentTime(0);
                    setDuration(parseDurationToSec(song.duration));
                    setIsPlaying(true);
                  }}
                  className={`flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-white/10 ${
                    currentSong?.id === song.id
                      ? "bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-400/50"
                      : ""
                  }`}
                >
                  {(() => {
                    const cover = song.image ?? uploadedImage ?? "/placeholder.svg";
                    return cover ? (
                      <Image
                        src={cover}
                        alt={song.title ?? "album cover"}
                        width={48}
                        height={48}
                        className="rounded-lg mr-3 border border-white/10 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg mr-3 bg-gray-300/40" />
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate text-sm">{song.title}</p>
                    <p className="text-slate-300 text-xs truncate">{song.artist}</p>
                  </div>
                  <div className="flex-shrink-0 ml-2">
                    <Badge variant="secondary" className="bg-white/10 text-slate-300 text-xs px-2 py-0.5 border-0">
                      {song.genre}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-slate-400 py-8">
              {isRefreshing ? "추천을 새로 불러오는 중입니다…" : "추천 음악이 없습니다."}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /** ---------- 뷰들 ---------- */

  // 1) 새 기본 뷰: 원본 사진을 크게 보여주는 '사진 플레이어' 뷰
  // - 세로형: 기존 정사각형(36rem) 박스에 object-cover로 꽉 차게 (여백 없음)
  // - 가로형: 더 가로로 넓은 박스(44rem x 28rem)에 object-cover로 채워서 레터박스/여백 제거
  const PhotoPlayerView = () => {
    // 박스 크기를 비율에 따라 다르게
    const portraitBox = "w-[36rem] h-[36rem]";
    const landscapeBox = "w-[44rem] h-[28rem]"; // ~16:10
    const box = isLandscape ? landscapeBox : portraitBox;

    return (
      <div className="flex items-center justify-between w-full h-full px-8">
        {/* Left: 업로드 원본 사진 (img + object-cover) */}
        <div className="flex items-center justify-center flex-1">
          {uploadedImage && (
            <img
              src={uploadedImage}
              alt="uploaded photo"
              className={`${box} max-w-[90vw] max-h-[80vh] rounded-3xl shadow-2xl border border-white/20 object-cover`}
            />
          )}
        </div>
        {/* Right: 공통 패널 */}
        <RightPane />
      </div>
    );
  };

  // 2) 기존 CD 플레이어 뷰 (오른쪽으로 이동하면 보임)
  const CDPlayerView = () => (
    <div className="flex items-center justify-between w-full h-full px-8">
      <div className="flex items-center justify-center flex-1">
        <div className="relative">
          <div className="relative w-80 h-80 cd-spin" style={spinDynamic}>
            <div className="w-full h-full rounded-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 shadow-2xl border-4 border-slate-300 relative">
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
      <RightPane />
    </div>
  );

  const InstagramView = () => (
    <div className="flex-1 flex items-center justify-center w-full h-full">
      <div className="text-slate-300">Instagram View (준비 중)</div>
    </div>
  );

  const DefaultView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="text-slate-300">Default View (준비 중)</div>
    </div>
  );

  const renderCurrentView = () => {
    switch (views[currentViewIndex]) {
      case "photo":
        return <PhotoPlayerView />;
      case "cd":
        return <CDPlayerView />;
      case "instagram":
        return <InstagramView />;
      default:
        return <DefaultView />;
    }
  };

  /** 네비게이션/뷰 전환 */
  const handleClose = () => {
    try { router.replace("/"); } catch { (window as unknown as { location: Location }).location.href = "/"; }
  };

  const handlePrevView = () => setCurrentViewIndex((prev) => (prev - 1 + views.length) % views.length);
  const handleNextView = () => setCurrentViewIndex((prev) => (prev + 1) % views.length);

  return (
    <div className="fixed inset-0 z-40 bg-black bg-opacity-95 flex items-center justify-center">
      <div className="absolute inset-0 bg-cover bg-center blur-md scale-110" style={safeBgStyle} />
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black/50 to-pink-900/30" />
      <div className="absolute top-6 right-6 z-50">
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
        className="absolute right-6 top-1/2 -translate-y-1/2 z-40 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full p-4 transition-all duration-200 hover:scale-110 border border-white/20"
        type="button"
      >
        <ChevronRight className="h-6 w-6 text-white" />
      </button>

      <div className="relative z-30 w-full h-full flex items-center justify-center px-20">
        {renderCurrentView()}
      </div>
    </div>
  );
}
