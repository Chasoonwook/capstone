// src/app/recommend/RecommendClient.tsx
"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { RotateCcw, X, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown } from "lucide-react";
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

/* ------------------------------------------------------------------ */
/*                       로그인 토큰 / 유저 확인 유틸                   */
/* ------------------------------------------------------------------ */

// 1) (서비스에 맞춰 필요한 키들 추가 가능)
const APP_TOKEN_KEYS = ["app_token", "auth_token", "token", "access_token"];

// 2) Bearer 로 보낼 앱 토큰 읽기
function readAppBearerToken(): string | null {
  for (const key of APP_TOKEN_KEYS) {
    try {
      const v = localStorage.getItem(key);
      if (v && v.length > 10) return v;
    } catch {}
  }
  return null;
}

// 3) me 호출(Authorization 우선, 실패 시 쿠키 기반)
async function fetchMe(): Promise<{ id: number } | null> {
  // (a) Authorization 헤더 우선
  try {
    const t = readAppBearerToken();
    if (t) {
      const r = await fetch(`${API_BASE}/api/auth/me`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${t}` },
      });
      if (r.ok) {
        const me = await r.json().catch(() => null);
        const id = me?.id ?? me?.user_id ?? me?.user?.id ?? null;
        return id ? { id: Number(id) } : null;
      }
    }
  } catch {}

  // (b) 쿠키 기반(서버에 httpOnly 쿠키가 설정된 경우)
  try {
    const r = await fetch(`${API_BASE}/api/auth/me`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const me = await r.json().catch(() => null);
      const id = me?.id ?? me?.user_id ?? me?.user?.id ?? null;
      return id ? { id: Number(id) } : null;
    }
  } catch {}

  // (c) (프로젝트에 따라 /api/users/me 를 병행)
  try {
    const t = readAppBearerToken();
    const r = await fetch(`${API_BASE}/api/users/me`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    });
    if (r.ok) {
      const me = await r.json().catch(() => null);
      const id = me?.id ?? me?.user_id ?? me?.user?.id ?? null;
      return id ? { id: Number(id) } : null;
    }
  } catch {}

  return null;
}

/* ------------------------------------------------------------------ */
/*                            컴포넌트 본문                            */
/* ------------------------------------------------------------------ */

export default function RecommendClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const photoId = searchParams.get("photoId");

  // Spotify 전체듣기 토큰(재생용) — 로그인/피드백과는 별개
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const isLoggedInSpotify = !!accessToken;
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

  // 미리듣기 오디오
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playReqIdRef = useRef(0);
  const [source, setSource] = useState<"preview" | "spotify" | null>(null);

  // 화면 상태
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

  // (불필요한 미사용 state 제거: isLoggedInApp 경고 원인)
  // 로그인 여부를 화면에서 활용하지 않으므로 제거했습니다.
  // 필요해지면 아래 주석을 해제하고 실제 UI에 사용하세요.
  // const [isLoggedInApp, setIsLoggedInApp] = useState<boolean>(false);
  // useEffect(() => {
  //   let mounted = true;
  //   (async () => {
  //     const me = await fetchMe();
  //     if (mounted) setIsLoggedInApp(!!me?.id);
  //   })();
  //   return () => { mounted = false; };
  // }, []);

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

  /* ---------------- 이미지 로드 ---------------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!photoId) { setUploadedImage(null); return; }
      const candidates = [
        `${API_BASE}/api/photos/${photoId}/binary`,
        `${API_BASE}/photos/${photoId}/binary`,
      ];
      let url: string | null = null;
      for (const u of candidates) {
        try {
          const r = await fetch(u, { method: "GET" });
          if (r.ok) { url = u; break; }
        } catch {}
      }
      if (mounted) setUploadedImage(url ?? "/placeholder.svg");
    })();
    return () => { mounted = false; };
  }, [photoId]);

  useEffect(() => {
    if (!uploadedImage) { setIsLandscape(null); return; }
    const img = new window.Image();
    img.src = uploadedImage;
    img.onload = () => setIsLandscape(img.naturalWidth > img.naturalHeight);
  }, [uploadedImage]);

  /* ---------------- 추천 불러오기 ---------------- */
  const fetchRecommendations = useCallback(
    async (signal?: AbortSignal) => {
      if (!photoId) {
        setRecommendations([]); setCurrentSong(null); setContextMainMood(null); setContextSubMood(null);
        return;
      }
      try {
        const r = await fetch(
          `${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}?debug=1`,
          { signal, credentials: "include" }
        );
        if (!r.ok) {
          console.error("[by-photo] 실패:", r.status, await r.text());
          setRecommendations([]); setCurrentSong(null); setContextMainMood(null); setContextSubMood(null);
          return;
        }

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

        setContextMainMood(data.main_mood ?? null);
        setContextSubMood(data.sub_mood ?? null);

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
        setFeedbackMap({});
      } catch (e) {
        console.error("추천 불러오기 오류:", e);
        setRecommendations([]); setCurrentSong(null);
        setContextMainMood(null); setContextSubMood(null);
        setFeedbackMap({});
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

  /* ---------------- 자동 전체듣기(Spotify) ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isLoggedInSpotify || !accessToken || !ready) return;
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
  }, [isLoggedInSpotify, accessToken, ready, normalizedCurrentUri, source, activate, transferToThisDevice, playUris]);

  // preview 타이머
  useEffect(() => {
    if (!isPlaying || source !== "preview") return;
    const id = setInterval(() => {
      setCurrentTime((t) => (t + 1 > duration ? duration : t + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration, source]);

  /* ---------------- 재생 로직 ---------------- */
  const playSong = async (song: Song) => {
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(parseDurationToSec(song.duration));
    const songUri = toSpotifyUri(song.spotify_uri ?? null);

    if (isLoggedInSpotify && accessToken && ready && songUri) {
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
        prev.map((s) => s.id === song.id ? {
          ...s,
          preview_url: preview ?? s.preview_url,
          image: cover ?? s.image,
          spotify_uri: uri ?? s.spotify_uri
        } : s)
      );
      setCurrentSong((prev) => (prev ? {
        ...prev,
        preview_url: preview ?? prev.preview_url,
        image: cover ?? prev.image,
        spotify_uri: uri ?? prev.spotify_uri
      } : prev));
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
      try {
        if (isPlaying) { await pause(); setIsPlaying(false); }
        else { await resume(); setIsPlaying(true); }
      } catch (e) { console.error("[togglePlay][spotify] failed:", e); }
      return;
    }

    const tryUri = normalizedCurrentUri;
    if (isLoggedInSpotify && accessToken && ready && tryUri) {
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

  // 피드백 상태 & 컨텍스트
  const [feedbackMap, setFeedbackMap] = useState<Record<string | number, 1 | -1 | 0>>({});
  const [contextMainMood, setContextMainMood] = useState<string | null>(null);
  const [contextSubMood, setContextSubMood] = useState<string | null>(null);

  /* ---------------- 피드백 전송(Authorization 헤더 고정) ---------------- */
  const sendFeedback = useCallback(
    async (musicId: string | number, value: 1 | -1) => {
      const token = readAppBearerToken();
      if (!token) {
        // 쿠키 세션이 있다면 통과시켜도 되지만, UX상 명확히 알림
        const me = await fetchMe();
        if (!me) {
          alert("로그인이 필요합니다. (앱 토큰이 없습니다)");
          return false;
        }
      }

      const payload = {
        // user_id 제거: 서버가 토큰에서 식별
        music_id: Number(musicId),
        feedback: value,
        photo_id: photoId ?? null,
        context_main_mood: contextMainMood ?? null,
        context_sub_mood: contextSubMood ?? null,
      };

      try {
        const r = await fetch(`${API_BASE}/api/feedback`, {
          method: "POST",
          credentials: "include", // 쿠키 병행 허용
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          console.error("feedback failed:", r.status, t);
          alert("피드백 전송에 실패했습니다.");
          return false;
        }
        return true;
      } catch (e) {
        console.error("feedback error:", e);
        alert("네트워크 오류로 피드백 전송을 실패했습니다.");
        return false;
      }
    },
    [photoId, contextMainMood, contextSubMood]
  );

  const handleFeedback = useCallback(
    async (value: 1 | -1) => {
      if (!currentSong) return;
      const key = currentSong.id;
      const prev = feedbackMap[key] ?? 0;

      const nextVal: 1 | -1 | 0 = prev === value ? 0 : value;
      setFeedbackMap((m) => ({ ...m, [key]: nextVal }));

      if (nextVal === 0) return;

      const ok = await sendFeedback(key, nextVal);
      if (!ok) setFeedbackMap((m) => ({ ...m, [key]: prev }));
    },
    [currentSong, feedbackMap, sendFeedback]
  );

  /* ---------------- 뷰 ---------------- */
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
      <div className="flex flex-col items-center mb-4">
        <div
          className="w-24 h-24 rounded-lg overflow-hidden mb-4 bg-center bg-cover border border-white/20"
          style={{ backgroundImage: `url(${currentSong?.image ?? safeImageSrc})` }}
        />
        <div className="text-center mb-2">
          <h3 className="text-white text-2xl font-semibold mb-1">{currentSong?.title ?? "—"}</h3>
          <p className="text-slate-300 text-lg">{currentSong?.artist ?? "—"}</p>
        </div>

        {(contextMainMood || contextSubMood) && (
          <div className="text-xs text-slate-400 mb-2">
            context: {contextMainMood ?? "—"}{contextSubMood ? ` / ${contextSubMood}` : ""}
          </div>
        )}

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

        {/* 재생 바 아래: Like/Dislike */}
        {currentSong && (
          <div className="mt-4 flex items-center gap-3">
            <Button
              type="button"
              title="Like"
              className={`h-9 px-3 border text-white bg-white/10 hover:bg-white/20 border-white/25 ${
                feedbackMap[currentSong.id] === 1 ? "bg-white/30 border-white/40" : ""
              }`}
              onClick={() => handleFeedback(1)}
            >
              <ThumbsUp className="h-4 w-4 mr-2" />
              Like
            </Button>
            <Button
              type="button"
              title="Dislike"
              className={`h-9 px-3 border text-white bg-white/10 hover:bg-white/20 border-white/25 ${
                feedbackMap[currentSong.id] === -1 ? "bg-white/30 border-white/40" : ""
              }`}
              onClick={() => handleFeedback(-1)}
            >
              <ThumbsDown className="h-4 w-4 mr-2" />
              Dislike
            </Button>
          </div>
        )}
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
          <div
            className={`${isLandscape ? "w-[44rem] h-[28rem]" : "w-[36rem] h-[36rem]"} max-w-[90vw] max-h-[80vh] rounded-3xl shadow-2xl border border-white/20 overflow-hidden relative`}
          >
            {/* next/image로 교체 (ESLint: no-img-element 해결) */}
            <Image
              src={uploadedImage}
              alt="uploaded photo"
              fill
              unoptimized
              className="object-cover"
              sizes="(max-width: 1024px) 90vw, 44rem"
            />
          </div>
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
