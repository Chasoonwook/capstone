"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RotateCcw, X, ChevronLeft, ChevronRight } from "lucide-react";
import { API_BASE } from "@/lib/api";

import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";
import PlayerControls from "./components/PlayerControls";
import RecommendationList from "./components/RecommendationList";
import {
  formatTime,
  parseDurationToSec,
  toSpotifyUri,
  resolvePreviewAndCover,
  toBackendSongArray,
} from "./utils/media";
import type { Song, BackendSong, ByPhotoResponse } from "./types";

/** 업로드 이미지 URL */
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

export default function RecommendClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const photoId = searchParams.get("photoId");

  // 메뉴 탭에서 연동된 토큰만 사용
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const isLoggedIn = !!accessToken;
  useEffect(() => {
    const read = () => {
      try {
        const t = localStorage.getItem("spotify_access_token");
        setAccessToken(t && t.trim() ? t : null);
      } catch {
        setAccessToken(null);
      }
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "spotify_access_token") read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { ready, activate, transferToThisDevice, playUris, resume, pause } =
    useSpotifyPlayer(accessToken);

  // 미리듣기 전용 오디오
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playReqIdRef = useRef(0);
  const [source, setSource] = useState<"preview" | "spotify" | null>(null);

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(180);

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const views = ["photo", "cd", "instagram", "default"] as const;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLandscape, setIsLandscape] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

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

    if (myId !== playReqIdRef.current) return;
    try { await a.play(); } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
    }
  }, []);

  // 1) 업로드 이미지 URL
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

  // 2) 추천 불러오기
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

        const mapped: Song[] = await Promise.all(
          dedup.map(async (it, idx) => {
            const sec = typeof it.duration === "number" ? it.duration :
                        typeof it.duration_sec === "number" ? it.duration_sec : 180;
            const mm = Math.floor(sec / 60);
            const ss = String(sec % 60).padStart(2, "0");

            let image: string | null = null;
            let uri = toSpotifyUri(it.spotify_uri ?? null);
            let preview = it.preview_url ?? null;

            try {
              if (!uri || !preview || !image) {
                const info = await resolvePreviewAndCover(it.title, it.artist);
                uri = uri ?? toSpotifyUri(info.uri);
                preview = preview ?? info.preview;
                image = image ?? info.cover;
              }
            } catch {}

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

  // 목록 보강(커버/프리뷰/URI)
  useEffect(() => {
    if (!recommendations.length) return;
    let cancelled = false;
    (async () => {
      const tasks = recommendations.map(async (s, idx) => {
        if (s.image && s.preview_url && s.spotify_uri) return null;
        try {
          const info = await resolvePreviewAndCover(s.title, s.artist);
          const next = {
            image: s.image ?? info.cover ?? null,
            preview_url: s.preview_url ?? info.preview ?? null,
            spotify_uri: s.spotify_uri ?? toSpotifyUri(info.uri) ?? null,
          };
          if (next.image === s.image && next.preview_url === s.preview_url && next.spotify_uri === s.spotify_uri) {
            return null;
          }
          if (next.image && typeof window !== "undefined") {
            await new Promise<void>((res) => {
              const img = new window.Image();
              img.onload = () => res();
              img.onerror = () => res();
              img.src = next.image!;
            });
          }
          return { idx, next };
        } catch {
          return null;
        }
      });

      const results = await Promise.allSettled(tasks);
      if (cancelled) return;

      const updates: Array<{ idx: number; next: Partial<Song> }> = [];
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) updates.push(r.value);
      }
      if (!updates.length) return;

      setRecommendations((prev) => {
        const copy = [...prev];
        for (const u of updates) {
          const cur = copy[u.idx];
          if (cur) copy[u.idx] = { ...cur, ...u.next };
        }
        return copy;
      });

      setCurrentSong((cur) => {
        if (!cur) return cur;
        const hit = updates.find((u) => recommendations[u.idx]?.id === cur.id);
        return hit ? { ...cur, ...hit.next } : cur;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendations.map((s) => s.id).join(",")]);

  const normalizedCurrentUri = useMemo(
    () => toSpotifyUri(currentSong?.spotify_uri ?? null),
    [currentSong?.spotify_uri]
  );

  // 로그인 + SDK 준비 + URI 있으면 자동 전체듣기
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isLoggedIn || !accessToken || !ready) return;
      if (!normalizedCurrentUri) return;
      if (source === "spotify" && isPlayingRef.current) return;

      try {
        audioRef.current?.pause();
        await activate();
        await transferToThisDevice();
        await playUris([normalizedCurrentUri]);
        if (cancelled) return;
        setSource("spotify");
        setIsPlaying(true);
      } catch (e) {
        console.error("Auto full playback failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, accessToken, ready, normalizedCurrentUri, source, activate, transferToThisDevice, playUris]);

  // preview 타이머
  useEffect(() => {
    if (!isPlaying || source !== "preview") return;
    const id = setInterval(() => {
      setCurrentTime((t) => (t + 1 > duration ? duration : t + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration, source]);

  /** --------- 재생 로직 --------- */
  const playSong = async (song: Song) => {
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(parseDurationToSec(song.duration));
    const songUri = toSpotifyUri(song.spotify_uri ?? null);

    if (isLoggedIn && accessToken && ready && songUri) {
      try {
        await activate();
        await transferToThisDevice();
        await playUris([songUri]);
        setIsPlaying(true);
        setSource("spotify");
        return;
      } catch (e) {
        console.warn("Spotify full playback failed, trying preview fallback:", e);
      }
    }

    // preview fallback
    let preview = song.preview_url ?? null;
    let cover = song.image ?? null;
    let uri = songUri ?? null;

    if (!preview || !cover || !uri) {
      const info = await resolvePreviewAndCover(song.title, song.artist);
      preview = preview ?? info.preview;
      cover   = cover   ?? info.cover;
      uri     = uri     ?? toSpotifyUri(info.uri);

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
      alert("이 곡은 미리듣기 음원이 없습니다. 전체 듣기는 상단 사용자 메뉴에서 Spotify 연동 후 이용하세요.");
      setIsPlaying(false);
    }
  };

  const togglePlay = async () => {
    if (!currentSong) {
      if (recommendations.length === 0) return;
      await playSong(recommendations[0]);
      return;
    }

    if (source === "spotify") {
      if (!accessToken) return;
      try {
        if (isPlaying) { await pause(); setIsPlaying(false); }
        else { await resume(); setIsPlaying(true); }
      } catch (e) { console.error("[togglePlay][spotify] failed:", e); }
      return;
    }

    const tryUri = normalizedCurrentUri;
    if (isLoggedIn && accessToken && ready && tryUri) {
      try {
        await activate(); await transferToThisDevice(); await playUris([tryUri]);
        setSource("spotify"); setIsPlaying(true); return;
      } catch (e) { console.warn("[togglePlay] upgrade to Spotify failed, fallback preview:", e); }
    }

    const a = audioRef.current!;
    try { if (isPlaying) { a.pause(); setIsPlaying(false); } else { await a.play(); setIsPlaying(true); } }
    catch (e) { console.error("[togglePlay][preview] play failed:", e); }
  };

  const playNextSong = async () => {
    if (busy || recommendations.length === 0) return;
    setBusy(true);
    try {
      const curIdx = currentSong ? recommendations.findIndex(s => s.id === currentSong.id) : -1;
      const nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % recommendations.length;
      await playSong(recommendations[nextIdx]);
    } finally { setBusy(false); }
  };

  const onClickSong = async (song: Song) => {
    if (busy) return;
    setBusy(true);
    try { await playSong(song); } finally { setBusy(false); }
  };

  const playPreviousSong = async () => {
    if (busy || recommendations.length === 0) return;
    setBusy(true);
    try {
      const curIdx = currentSong ? recommendations.findIndex(s => s.id === currentSong.id) : 0;
      const prevIdx = curIdx <= 0 ? recommendations.length - 1 : curIdx - 1;
      await playSong(recommendations[prevIdx]);
    } finally { setBusy(false); }
  };

  /** ---------- 뷰 ---------- */
  const safeImageSrc = useMemo(() => uploadedImage || "/placeholder.svg", [uploadedImage]);
  const safeBgStyle = useMemo(() => ({ backgroundImage: `url(${safeImageSrc})` }), [safeImageSrc]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    try {
      setIsRefreshing(true);
      audioRef.current?.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      await fetchRecommendations();
    } finally {
      setIsRefreshing(false);
    }
  };

  const rightPane = (
    <div className="flex flex-col justify-center flex-1 h-full ml-8">
      {/* 곡 정보 */}
      <div className="flex flex-col items-center mb-6">
        <div
          className="w-24 h-24 rounded-lg overflow-hidden mb-4 bg-center bg-cover border border-white/20"
          style={{ backgroundImage: `url(${currentSong?.image ?? safeImageSrc})` }}
        />
        <div className="text-center mb-2">
          <h3 className="text-white text-2xl font-semibold mb-1">{currentSong?.title ?? "—"}</h3>
          <p className="text-slate-300 text-lg">{currentSong?.artist ?? "—"}</p>
        </div>

        {/* 타임 라벨 */}
        <div className="w-full max-w-md mb-2 text-slate-300 text-sm flex justify-between">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* 컨트롤 */}
        <PlayerControls
          isPlaying={isPlaying}
          busy={busy}
          currentTime={currentTime}
          duration={duration}
          onSeek={(v) => {
            setCurrentTime(v);
            if (source === "preview" && audioRef.current) audioRef.current.currentTime = v;
          }}
          onTogglePlay={togglePlay}
          onNext={playNextSong}
          onPrev={playPreviousSong}
        />
      </div>

      {/* 추천 목록 */}
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
            <RecommendationList
              items={recommendations}
              currentId={currentSong?.id ?? null}
              uploadedImage={uploadedImage}
              onClickItem={onClickSong}
            />
          ) : (
            <div className="text-center text-slate-400 py-8">추천 음악이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );

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
      <div className="absolute inset-0 bg-cover bg-center blur-md scale-110 pointer-events-none" style={safeBgStyle} />
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-black/50 to-pink-900/30 pointer-events-none" />
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
