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

// Spotify 훅
import { useSpotifyAuth } from "@/hooks/useSpotifyAuth";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";

/** ---------- 타입 ---------- */
type Song = {
  id: number | string;
  title: string;
  artist: string;
  genre: string;
  duration?: string;
  image?: string | null;
  spotify_uri?: string | null;   // 있으면 SDK로 전체 재생
  preview_url?: string | null;   // 미리듣기 mp3
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
  spotify_uri?: string | null;
  preview_url?: string | null;
};

type ByPhotoResponse = {
  main_mood?: string | null;
  sub_mood?: string | null;
  main_songs?: BackendSong[];
  sub_songs?: BackendSong[];
  preferred_songs?: BackendSong[];
  preferred_genres?: string[];
};

type PreviewSource = "spotify" | "itunes" | "deezer" | null;

type PreviewProbeResult = {
  preview: string | null;
  cover: string | null;
  uri: string | null;
  source: PreviewSource;
};

/** ---------- 유틸 ---------- */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isBackendSong = (v: unknown): v is BackendSong => {
  if (!isRecord(v)) return false;
  const { music_id, id, title, artist, label, genre, duration, duration_sec } = v as Record<string, unknown>;
  const isOptStr = (x: unknown) => typeof x === "string" || typeof x === "undefined" || x === null;
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

/** ---------- 프리뷰/커버 보강 ---------- */
type SpotifyImage = { url: string; height: number; width: number };

async function findSpotifyInfo(
  title?: string,
  artist?: string
): Promise<{ uri: string | null; preview: string | null; cover: string | null }> {
  const term = [title ?? "", artist ?? ""].join(" ").trim();
  if (!term) return { uri: null, preview: null, cover: null };
  try {
    const url = new URL("/api/spotify/search", window.location.origin);
    url.searchParams.set("query", term);
    url.searchParams.set("markets", "KR,US,JP,GB,DE,FR,CA,AU,BR,MX,SE,NL,ES,IT");
    url.searchParams.set("limit", "5");
    const r = await fetch(url.toString(), { cache: "no-store" });
    if (!r.ok) return { uri: null, preview: null, cover: null };
    const js = await r.json();
    if (js?.ok) {
      return { uri: js.uri ?? null, preview: js.preview_url ?? null, cover: js.image ?? null };
    }
    return { uri: null, preview: null, cover: null };
  } catch {
    return { uri: null, preview: null, cover: null };
  }
}

async function findItunesPreview(title?: string, artist?: string) {
  const term = [title ?? "", artist ?? ""].join(" ").trim();
  if (!term) return { preview: null, cover: null };
  try {
    const r = await fetch(`/api/preview/itunes?term=${encodeURIComponent(term)}`, { cache: "no-store" });
    if (!r.ok) return { preview: null, cover: null };
    const js = await r.json();
    return js?.ok ? { preview: js.preview_url ?? null, cover: js.image ?? null }
                  : { preview: null, cover: null };
  } catch { return { preview: null, cover: null }; }
}

async function findDeezerPreview(title?: string, artist?: string) {
  const term = [title ?? "", artist ?? ""].join(" ").trim();
  if (!term) return { preview: null, cover: null };
  try {
    const r = await fetch(`/api/preview/deezer?term=${encodeURIComponent(term)}`, { cache: "no-store" });
    if (!r.ok) return { preview: null, cover: null };
    const js = await r.json();
    return js?.ok ? { preview: js.preview_url ?? null, cover: js.image ?? null }
                  : { preview: null, cover: null };
  } catch { return { preview: null, cover: null }; }
}

async function resolvePreviewAndCover(
  title?: string,
  artist?: string
): Promise<PreviewProbeResult> {
  // 1) Spotify
  const sp = await findSpotifyInfo(title, artist);
  if (sp.preview) {
    return { preview: sp.preview, cover: sp.cover, uri: sp.uri, source: "spotify" };
  }

  // 2) iTunes
  const it = await findItunesPreview(title, artist);
  if (it.preview) {
    return { preview: it.preview, cover: it.cover, uri: sp.uri ?? null, source: "itunes" };
  }

  // 3) Deezer
  const dz = await findDeezerPreview(title, artist);
  if (dz.preview) {
    return { preview: dz.preview, cover: dz.cover, uri: sp.uri ?? null, source: "deezer" };
  }

  return {
    preview: null,
    cover: sp.cover ?? it.cover ?? dz.cover ?? null,
    uri: sp.uri ?? null,
    source: null, // 이제 오류 없음
  };
}

/* =======================  컴포넌트  ======================= */

export default function RecommendClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const photoId = searchParams.get("photoId");

  // Spotify
  const { isLoggedIn, accessToken, login: spLogin } = useSpotifyAuth();
  const { playUris, resume, pause } = useSpotifyPlayer(accessToken);

  // 미리듣기용 오디오
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playReqIdRef = useRef(0);     // 연타/레이스 방지용
  const [source, setSource] = useState<"preview" | "spotify" | null>(null);

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(180);

  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const views = ["photo", "cd", "instagram", "default"] as const;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLandscape, setIsLandscape] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false); // next/prev 중복 방지

  // 오디오 태그 준비
  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current!;
    a.crossOrigin = "anonymous";
    a.preload = "none";
    const onTime = () => setCurrentTime(Math.floor(a.currentTime));
    const onEnd = () => setIsPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      try { a.pause(); } catch {}
    };
  }, []);

  /** 안전한 프리뷰 재생 (AbortError/레이스 방지) */
  const safePlayPreview = useCallback(async (src: string) => {
    const a = audioRef.current!;
    const myId = ++playReqIdRef.current;

    try { a.pause(); } catch {}
    a.src = src;
    a.currentTime = 0;

    await new Promise<void>((res) => {
      const onCanPlay = () => { a.removeEventListener("canplay", onCanPlay); res(); };
      a.addEventListener("canplay", onCanPlay);
      a.load();
    });

    if (myId !== playReqIdRef.current) return; // 최신 요청만 실행
    try {
      await a.play();
    } catch (e) {
      // 다른 인터럽트는 무시
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        throw e;
      }
    }
  }, []);

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

  // 가로/세로 판별
  useEffect(() => {
    if (!uploadedImage) { setIsLandscape(null); return; }
    const img = new window.Image();
    img.src = uploadedImage;
    img.onload = () => setIsLandscape(img.naturalWidth > img.naturalHeight);
  }, [uploadedImage]);

  /** 2) 추천 불러오기 */
  const fetchRecommendations = useCallback(
    async (signal?: AbortSignal) => {
      if (!photoId) { setRecommendations([]); setCurrentSong(null); return; }

      try {
        const r = await fetch(`${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}?debug=1`, { signal });
        if (!r.ok) { console.error("[by-photo] 실패:", r.status, await r.text()); setRecommendations([]); setCurrentSong(null); return; }

        const raw: unknown = await r.json();
        const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

        const data: ByPhotoResponse = obj
          ? {
              main_mood: obj["main_mood"] as string | null,
              sub_mood: obj["sub_mood"] as string | null,
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

        // 추천 → Song 매핑: 우선 Spotify로 보강
        const mapped: Song[] = await Promise.all(
          dedup.map(async (it, idx) => {
            const sec = typeof it.duration === "number" ? it.duration :
                        typeof it.duration_sec === "number" ? it.duration_sec : 180;
            const mm = Math.floor(sec / 60);
            const ss = String(sec % 60).padStart(2, "0");

            let image: string | null = null;
            let uri = it.spotify_uri ?? null;
            let preview = it.preview_url ?? null;

            if (!uri || !preview || !image) {
              const info = await findSpotifyInfo(it.title, it.artist);
              uri = uri ?? info.uri;
              preview = preview ?? info.preview;
              image = image ?? info.cover;
            }

            return {
              id: it.music_id ?? it.id ?? idx,
              title: it.title ?? "Unknown Title",
              artist: it.artist ?? "Unknown Artist",
              genre: it.genre ?? it.label ?? "UNKNOWN",
              duration: `${mm}:${ss}`,
              image,
              spotify_uri: uri,
              preview_url: preview,
            };
          })
        );

        setRecommendations(mapped);
        const first = mapped[0] ?? null;
        setCurrentSong(first);
        setCurrentTime(0);
        setIsPlaying(false);
        setDuration(parseDurationToSec(first?.duration));
        setSource(null);
      } catch (e) {
        console.error("추천 불러오기 오류:", e);
        setRecommendations([]); setCurrentSong(null);
      }
    },
    [photoId]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRecommendations(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchRecommendations]);

  /** 타이머(Spotify일 때는 SDK가 관리하므로 preview만 카운트) */
  useEffect(() => {
    if (!isPlaying || source !== "preview") return;
    const id = setInterval(() => {
      setCurrentTime((t) => (t + 1 > duration ? duration : t + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration, source]);

  /** 컨트롤 */
  const togglePlay = async () => {
    if (source === "spotify") {
      if (!accessToken) return;
      try {
        if (isPlaying) await pause();
        else await resume();
        setIsPlaying((p) => !p);
      } catch (e) { console.error(e); }
      return;
    }
    // preview 모드
    const a = audioRef.current!;
    try {
      if (isPlaying) { a.pause(); setIsPlaying(false); }
      else { await a.play(); setIsPlaying(true); }
    } catch (e) { console.error(e); }
  };

  const playNextSong = async () => {
    if (busy || !currentSong || recommendations.length === 0) return;
    setBusy(true);
    try {
      const i = recommendations.findIndex((s) => s.id === currentSong.id);
      const nextIdx = (i + 1) % recommendations.length;
      const nextSong = recommendations[nextIdx];
      await playSong(nextSong);
    } finally { setBusy(false); }
  };

  const playPreviousSong = async () => {
    if (busy || !currentSong || recommendations.length === 0) return;
    setBusy(true);
    try {
      const i = recommendations.findIndex((s) => s.id === currentSong.id);
      const prevIdx = i === 0 ? recommendations.length - 1 : i - 1;
      const prevSong = recommendations[prevIdx];
      await playSong(prevSong);
    } finally { setBusy(false); }
  };

  // 재생 로직: Spotify 전체 재생 → (실패/미로그인) preview_url → 3단 폴백 즉시 보강
  const playSong = async (song: Song) => {
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(parseDurationToSec(song.duration));

    // 전체 재생(Spotify Premium + uri 존재)
    if (accessToken && song.spotify_uri) {
      try {
        await playUris([song.spotify_uri]);
        setIsPlaying(true);
        setSource("spotify");
        return;
      } catch (e) {
        console.error("Spotify play error", e);
      }
    }

    // 미리듣기: preview_url이 없으면 3단 폴백으로 보강
    let preview = song.preview_url ?? null;
    let cover = song.image ?? null;
    let uri = song.spotify_uri ?? null;

    if (!preview || !cover || !uri) {
      const info = await resolvePreviewAndCover(song.title, song.artist);
      preview = preview ?? info.preview;
      cover   = cover   ?? info.cover;
      uri     = uri     ?? info.uri;

      // 보강 결과 반영
      setRecommendations((prev) =>
        prev.map((s) => s.id === song.id ? { ...s, preview_url: preview ?? s.preview_url, image: cover ?? s.image, spotify_uri: uri ?? s.spotify_uri } : s)
      );
      setCurrentSong((prev) => (prev ? { ...prev, preview_url: preview ?? prev.preview_url, image: cover ?? prev.image, spotify_uri: uri ?? prev.spotify_uri } : prev));
    }

    if (preview) {
      try {
        await safePlayPreview(preview);
        setSource("preview");
        setIsPlaying(true);
      } catch (e) {
        console.error(e);
        setIsPlaying(false);
      }
    } else {
      alert("이 곡은 세 서비스에서 모두 미리듣기를 제공하지 않네요. 전체 듣기는 Spotify 로그인 후 가능합니다.");
      setIsPlaying(false);
    }
  };

  /** 리스트에서 클릭 시 */
  const onClickSong = async (song: Song) => {
    if (busy) return;
    setBusy(true);
    try { await playSong(song); } finally { setBusy(false); }
  };

  /** 배경/뷰 렌더링 등 UI 부분 */
  const safeImageSrc = useMemo(() => uploadedImage || "/placeholder.svg", [uploadedImage]);
  const safeBgStyle = useMemo(() => ({ backgroundImage: `url(${safeImageSrc})` }), [safeImageSrc]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    try {
      setIsRefreshing(true);
      const a = audioRef.current; a?.pause?.();
      setIsPlaying(false);
      setCurrentTime(0);
      await fetchRecommendations();
    } finally {
      setIsRefreshing(false);
    }
  };

  const ModeBadge = () => (
    <div className="text-xs text-slate-300 mb-2">
      {source === "spotify"
        ? "전체 재생 (Spotify)"
        : source === "preview"
        ? "미리듣기 재생"
        : "대기"}
    </div>
  );

  const rightPane = (
    <div className="flex flex-col justify-center flex-1 h-full ml-8">
      {/* Song Info & Controls */}
      <div className="flex flex-col items-center mb-8">
        <div
          className="w-24 h-24 rounded-lg overflow-hidden mb-4 bg-center bg-cover border border-white/20"
          style={{ backgroundImage: `url(${currentSong?.image ?? safeImageSrc})` }}
        />
        <div className="text-center mb-2">
          <h3 className="text-white text-2xl font-semibold mb-1">{currentSong?.title ?? "—"}</h3>
          <p className="text-slate-300 text-lg">{currentSong?.artist ?? "—"}</p>
        </div>
        <ModeBadge />

        {/* 미리듣기 → 전체 듣기 CTA (로그인 안 한 경우에만 노출) */}
        {!isLoggedIn && (
          <Button size="sm" className="mb-4 bg-green-600 hover:bg-green-700" onClick={() => spLogin()}>
            Spotify로 전체 듣기
          </Button>
        )}

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
            onChange={(e) => {
              const v = Number(e.target.value);
              setCurrentTime(v);
              if (source === "preview" && audioRef.current) {
                audioRef.current.currentTime = v;
              }
            }}
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
                  onClick={() => onClickSong(song)}
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
                        key={cover}                                   // src 바뀔 때 강제 재렌더
                        src={cover}
                        alt={song.title ?? "album cover"}
                        width={48}
                        height={48}
                        sizes="48px"
                        className="rounded-lg mr-3 border border-white/10 flex-shrink-0 !w-12 !h-12"
                        style={{ width: 48, height: 48 }}             // height:auto 경고 방지 (둘 다 명시)
                        unoptimized={typeof cover === "string" && cover.startsWith("data:")} // 데이터 URL 최적화 끔
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
            <div className="text-center text-slate-400 py-8">추천 음악이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );

  /** ---------- 뷰들 ---------- */
  const photoPlayerView = (
    <div className="flex items-center justify-between w-full h-full px-8">
      <div className="flex items-center justify-center flex-1">
        {uploadedImage && (
          <img
            src={uploadedImage}
            alt="uploaded photo"
            className={`${isLandscape ? "w-[44rem] h-[28rem]" : "w-[36rem] h-[36rem]"} max-w-[90vw] max-h-[80vh] rounded-3xl shadow-2xl border border-white/20 object-cover`}
          />
        )}
      </div>
      {rightPane}
    </div>
  );

  const cdPlayerView = (
    <div className="flex items-center justify-between w-full h-full px-8">
      <div className="flex items-center justify-center flex-1">
        <div className="relative">
          <div className="relative w-80 h-80">
            <div className="w-full h-full rounded-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 shadow-2xl border-4 border-slate-300 relative" />
          </div>
        </div>
      </div>
      {rightPane}
    </div>
  );

  const instagramView = (
    <div className="flex-1 flex items-center justify-center w-full h-full">
      <div className="text-slate-300">Instagram View (준비 중)</div>
    </div>
  );

  const defaultView = (
    <div className="flex-1 flex justify-center items-center">
      <div className="text-slate-300">Default View (준비 중)</div>
    </div>
  );

  const currentView =
    views[currentViewIndex] === "photo" ? photoPlayerView :
    views[currentViewIndex] === "cd"    ? cdPlayerView :
    views[currentViewIndex] === "instagram" ? instagramView :
    defaultView;

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
        {currentView}
      </div>
    </div>
  );
}
