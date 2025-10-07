"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { X, Play, Pause, SkipBack, SkipForward, ThumbsUp, ThumbsDown, Music, ChevronUp } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";
import { Button } from "@/components/ui/button";
import Image from "next/image";

import { parseDurationToSec, toSpotifyUri, resolvePreviewAndCover, formatTime } from "./utils/media";

import type { Song, BackendSong, ByPhotoResponse, SelectedFrom } from "./types";
import { buildAuthHeaderFromLocalStorage, fetchMe } from "./hooks/useAuthMe";

export default function RecommendClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const photoId = searchParams.get("photoId");

  const [showPlaylist, setShowPlaylist] = useState(false);

  // Web Playback SDK (쿠키 기반)
  const { ready, state, activate, transferToThisDevice, playUris, resume, pause, seek } = useSpotifyPlayer();

  // Spotify 연동 여부
  const [spotifyLinked, setSpotifyLinked] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/spotify/me`, { credentials: "include" });
        if (!mounted) return;
        setSpotifyLinked(r.ok);
      } catch { if (!mounted) return; setSpotifyLinked(false); }
    })();
    return () => { mounted = false; };
  }, []);

  // Audio(preview)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playReqIdRef = useRef(0);
  const [source, setSource] = useState<"preview" | "spotify" | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(180);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // 미리듣기 억제(Spotify 시작 직후 잠깐 preview 차단)
  const suppressPreviewUntilRef = useRef(0);
  const killPreview = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    try { a.pause(); } catch {}
    try { a.src = ""; a.load(); } catch {}
  }, []);

  // UI/State
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Data
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [contextMainMood, setContextMainMood] = useState<string | null>(null);
  const [contextSubMood, setContextSubMood] = useState<string | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<string | number | null>(null);

  // Init audio
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
    // Spotify 시작 직후 N초 동안은 미리듣기 금지(겹침 방지)
    if (Date.now() < suppressPreviewUntilRef.current) return;

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
    try { await a.play(); } catch {}
  }, []);

  // Load image
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!photoId) { setUploadedImage(null); return; }
      const candidates = [`${API_BASE}/api/photos/${photoId}/binary`, `${API_BASE}/photos/${photoId}/binary`];
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

  // Fetch recommendations (동일)
  const fetchRecommendations = useCallback(
    async (signal?: AbortSignal) => {
      if (!photoId) {
        setRecommendations([]); setCurrentSong(null); setContextMainMood(null); setContextSubMood(null); return;
      }
      try {
        const r = await fetch(`${API_BASE}/api/recommendations/by-photo/${encodeURIComponent(photoId)}?debug=1`, {
          signal, credentials: "include",
        });
        if (!r.ok) { setRecommendations([]); setCurrentSong(null); setContextMainMood(null); setContextSubMood(null); return; }
        const raw = await r.json();
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

        const mark = (arr: BackendSong[], tag: SelectedFrom) =>
          (arr ?? []).map((s) => ({ ...s, __selected_from__: tag as SelectedFrom }));

        const merged: (BackendSong & { __selected_from__?: SelectedFrom })[] = [
          ...mark(data.main_songs ?? [], "main"),
          ...mark(data.preferred_songs ?? [], "preferred"),
          ...mark(data.sub_songs ?? [], "sub"),
        ];

        const seen = new Set<string | number>();
        const dedup: (BackendSong & { __selected_from__?: SelectedFrom })[] = [];
        merged.forEach((s, i) => {
          const id = (s.music_id ?? s.id ?? i) as string | number;
          if (!seen.has(id)) { seen.add(id); dedup.push(s); }
        });

        const mapped: Song[] = await Promise.all(
          dedup.map(async (it, idx) => {
            const sec = typeof it.duration === "number"
              ? it.duration
              : typeof it.duration_sec === "number"
                ? it.duration_sec
                : 180;
            const mm = Math.floor(sec / 60);
            const ss = String(sec % 60).padStart(2, "0");

            let image: string | null = null;
            let uri = toSpotifyUri((it as any).spotify_uri ?? null);
            let preview = (it as any).preview_url ?? null;

            try {
              if (!uri || !preview || !image) {
                const info = await resolvePreviewAndCover(it.title as any, it.artist as any);
                uri = uri ?? toSpotifyUri(info.uri);
                preview = preview ?? info.preview;
                image = image ?? info.cover;
              }
            } catch {}

            return {
              id: (it as any).music_id ?? (it as any).id ?? idx,
              title: (it as any).title ?? "Unknown Title",
              artist: (it as any).artist ?? "Unknown Artist",
              genre: (it as any).genre ?? (it as any).label ?? "UNKNOWN",
              duration: `${mm}:${ss}`,
              image,
              spotify_uri: uri,
              preview_url: preview,
              selected_from: it.__selected_from__ ?? null,
            };
          }),
        );

        setRecommendations(mapped);
        const first = mapped[0] ?? null;
        setCurrentSong(first);
        setCurrentTime(0);
        setIsPlaying(false);
        setDuration(parseDurationToSec(first?.duration ?? "3:00"));
        setSource(null);
        setFeedbackMap({});
        setSelectedSongId(null);
      } catch {
        setRecommendations([]); setCurrentSong(null); setContextMainMood(null); setContextSubMood(null);
        setFeedbackMap({}); setSelectedSongId(null);
      }
    },
    [photoId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRecommendations(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchRecommendations]);

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
      for (const r of results) if (r.status === "fulfilled" && r.value) updates.push(r.value);

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
  }, [recommendations.map((s) => s.id).join(",")]);

  const normalizedCurrentUri = useMemo(
    () => toSpotifyUri(currentSong?.spotify_uri ?? null),
    [currentSong?.spotify_uri],
  );

  // ✅ Spotify 재생 상태와 진행바 동기화
  useEffect(() => {
    if (source !== "spotify") return;
    const posSec = Math.floor((state.position || 0) / 1000);
    const durSec =
      state.duration ? Math.floor(state.duration / 1000)
                     : parseDurationToSec(currentSong?.duration ?? "3:00");
    setCurrentTime(posSec);
    setDuration(durSec);
    setIsPlaying(!state.paused);
  }, [source, state.position, state.duration, state.paused, currentSong?.duration]);

  // ✅ 자동 재생(연동 + SDK 준비)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!spotifyLinked || !ready) return;
      if (!normalizedCurrentUri) return;
      if (source === "spotify" && isPlayingRef.current) return;

      // 미리듣기 완전 종료 + 억제 2.5초
      killPreview();
      suppressPreviewUntilRef.current = Date.now() + 2500;

      try {
        await activate();
        await transferToThisDevice();
        setSource("spotify");              // 먼저 소스 전환
        await playUris([normalizedCurrentUri]);
        if (cancelled) return;
        setIsPlaying(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [spotifyLinked, ready, normalizedCurrentUri, source, activate, transferToThisDevice, playUris, killPreview]);

  // ✅ 트랙 종료시 자동 다음 곡
  const lastTrackUriRef = useRef<string | null>(null);
  const autoNextLockRef = useRef(false);
  useEffect(() => {
    if (source !== "spotify") { autoNextLockRef.current = false; lastTrackUriRef.current = null; return; }

    // 트랙이 바뀌면 락 풀기
    if (state.trackUri && state.trackUri !== lastTrackUriRef.current) {
      lastTrackUriRef.current = state.trackUri;
      autoNextLockRef.current = false;
    }

    if (!state.duration) return;
    const timeLeft = state.duration - state.position; // ms
    if (timeLeft <= 800 && !autoNextLockRef.current) {
      autoNextLockRef.current = true;
      // 다음 곡으로
      void playNextSong();
    }
  }, [source, state.position, state.duration, state.trackUri]); // eslint-disable-line

  // 단일 곡 재생
  const playSong = async (song: Song) => {
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(parseDurationToSec(song.duration));
    const songUri = toSpotifyUri(song.spotify_uri ?? null);

    // 전체 재생 (연동 + SDK 준비)
    if (spotifyLinked && ready && songUri) {
      // 미리듣기 완전 종료 + 억제 2.5초
      killPreview();
      suppressPreviewUntilRef.current = Date.now() + 2500;

      try {
        await activate();
        await transferToThisDevice();
        setSource("spotify");
        await playUris([songUri]);
        setIsPlaying(true);
        return;
      } catch {}
    }

    // (미연동/실패) 미리듣기
    let preview = song.preview_url ?? null;
    let cover = song.image ?? null;
    let uri = songUri ?? null;
    if (!preview || !cover || !uri) {
      const info = await resolvePreviewAndCover(song.title, song.artist);
      preview = preview ?? info.preview;
      cover = cover ?? info.cover;
      uri = uri ?? toSpotifyUri(info.uri);
      setRecommendations((prev) =>
        prev.map((s) =>
          s.id === song.id ? { ...s, preview_url: preview ?? s.preview_url, image: cover ?? s.image, spotify_uri: uri ?? s.spotify_uri } : s
        ),
      );
      setCurrentSong((prev) => (prev ? { ...prev, preview_url: preview ?? prev.preview_url, image: cover ?? prev.image, spotify_uri: uri ?? prev.spotify_uri } : prev));
    }
    if (preview) {
      try {
        await safePlayPreview(preview);
        setSource("preview");
        setIsPlaying(true);
      } catch { setIsPlaying(false); }
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
      } catch {}
      return;
    }
    // 미리듣기 재생/정지
    const a = audioRef.current!;
    try {
      if (isPlaying) { a.pause(); setIsPlaying(false); }
      else { await a.play(); setIsPlaying(true); }
    } catch {}
  };

  const playNextSong = async () => {
    if (busy || recommendations.length === 0) return;
    setBusy(true);
    try {
      const curIdx = currentSong ? recommendations.findIndex((s) => s.id === currentSong.id) : -1;
      const nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % recommendations.length;
      const nextSong = recommendations[nextIdx];
      setSelectedSongId(nextSong.id);
      await playSong(nextSong);
    } finally { setBusy(false); }
  };

  const onClickSong = async (song: Song) => {
    if (busy) return;
    setBusy(true);
    try {
      setSelectedSongId(song.id);
      await playSong(song);
      setShowPlaylist(false);
    } finally { setBusy(false); }
  };

  const playPreviousSong = async () => {
    if (busy || recommendations.length === 0) return;
    setBusy(true);
    try {
      const curIdx = currentSong ? recommendations.findIndex((s) => s.id === currentSong.id) : 0;
      const prevIdx = curIdx <= 0 ? recommendations.length - 1 : curIdx - 1;
      const prevSong = recommendations[prevIdx];
      setSelectedSongId(prevSong.id);
      await playSong(prevSong);
    } finally { setBusy(false); }
  };

  // ✅ 슬라이더 Seek (Spotify/preview 공통)
  const handleSeek = async (v: number) => {
    setCurrentTime(v);
    if (source === "preview" && audioRef.current) {
      audioRef.current.currentTime = v;
    } else if (source === "spotify") {
      try { await seek(v * 1000); } catch {}
    }
  };

  // Feedback (생략 없이 동일)
  const [feedbackMap, setFeedbackMap] = useState<Record<string | number, 1 | -1 | 0>>({});
  const sendFeedback = useCallback(
    async (musicId: string | number, value: 1 | -1) => {
      const payload = {
        music_id: Number(musicId),
        feedback: value,
        photo_id: photoId ?? null,
        context_main_mood: contextMainMood ?? null,
        context_sub_mood: contextSubMood ?? null,
      };
      try {
        const r = await fetch(`${API_BASE}/api/feedback`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) return true;
        if (r.status !== 401) { alert("피드백 전송에 실패했습니다."); return false; }
      } catch {}
      const authHeader = buildAuthHeaderFromLocalStorage();
      if (!authHeader.Authorization) {
        const me = await fetchMe();
        if (!me) { alert("로그인이 필요합니다."); return false; }
      }
      try {
        const r2 = await fetch(`${API_BASE}/api/feedback`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(payload),
        });
        if (r2.ok) return true;
        if (r2.status === 401) alert("로그인이 필요합니다.");
        else alert("피드백 전송에 실패했습니다.");
        return false;
      } catch { alert("네트워크 오류로 피드백 전송 실패"); return false; }
    },
    [photoId, contextMainMood, contextSubMood],
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
    [currentSong, feedbackMap, sendFeedback],
  );

  const goEditOnly = useCallback(async () => {
    if (!photoId) { alert("photoId가 없습니다."); return; }
    if (!selectedSongId) { alert("편집할 곡을 먼저 선택해 주세요."); return; }
    const q = new URLSearchParams();
    q.set("photoId", String(photoId));
    q.set("musicId", String(selectedSongId));
    router.push(`/editor?${q.toString()}`);
  }, [photoId, selectedSongId, router]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    try {
      setIsRefreshing(true);
      audioRef.current?.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      await fetchRecommendations();
    } finally { setIsRefreshing(false); }
  };

  const handleClose = () => {
    try { router.replace("/"); } catch { (window as unknown as { location: Location }).location.href = "/"; }
  };

  const safeImageSrc = uploadedImage || "/placeholder.svg";
  const currentSongIndex = currentSong ? recommendations.findIndex((s) => s.id === currentSong.id) : 0;

  return (
    <div className="fixed inset-0 bg-black">
      {/* 상단 progress bars */}
      <div className="absolute top-0 left-0 right-0 z-50 flex gap-1 p-2">
        {recommendations.map((_, idx) => (
          <div key={idx} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
            <div
              className={`h-full bg-white transition-all duration-300 ${
                idx < currentSongIndex ? "w-full" : idx === currentSongIndex ? "w-1/2" : "w-0"
              }`}
            />
          </div>
        ))}
      </div>

      {/* Top header */}
      <div className="absolute top-0 left-0 right-0 z-40 bg-gradient-to-b from-black/80 to-transparent pt-10 px-4 pb-6">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="flex-1 mx-3">
            {currentSong && (
              <div className="text-white">
                <p className="text-sm font-semibold truncate">{currentSong.title}</p>
                <p className="text-xs text-white/80 truncate">{currentSong.artist}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Background image */}
      <div className="absolute inset-0">
        <Image src={safeImageSrc || "/placeholder.svg"} alt="Photo" fill className="object-cover" unoptimized />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-black/90 to-transparent px-4 pb-8 pt-12">
        {currentSong && (
          <div className="space-y-4">
            <button
              onClick={() => setShowPlaylist(!showPlaylist)}
              className="w-full flex items-center justify-center gap-2 py-2 text-white/80 hover:text-white transition-colors"
            >
              <Music className="w-4 h-4" />
              <span className="text-sm font-medium truncate">추천{recommendations.length}곡 리스트</span>
              <ChevronUp className={`w-4 h-4 transition-transform ${showPlaylist ? "rotate-180" : ""}`} />
            </button>

            {/* Progress bar */}
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={duration}
                value={currentTime}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3
                           [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                           [&::-webkit-slider-thumb]:bg-white"
              />
              <div className="flex justify-between text-xs text-white/70">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Player controls */}
            <div className="flex items-center justify-center gap-6">
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={playPreviousSong}
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white"
              >
                <SkipBack className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                disabled={busy}
                onClick={togglePlay}
                className="w-16 h-16 rounded-full bg-white hover:bg-white/90 text-black"
              >
                {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
              </Button>

              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={playNextSong}
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white"
              >
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>

            {/* Feedback buttons */}
            <div className="flex gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleFeedback(1)}
                className={`flex-1 h-11 rounded-full backdrop-blur-sm ${
                  feedbackMap[currentSong.id] === 1 ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                <ThumbsUp className="w-4 h-4 mr-2" />
                좋아요
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleFeedback(-1)}
                className={`flex-1 h-11 rounded-full backdrop-blur-sm ${
                  feedbackMap[currentSong.id] === -1
                    ? "bg-white text-black"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                <ThumbsDown className="w-4 h-4 mr-2" />
                별로예요
              </Button>
            </div>

            {/* Save button */}
            {selectedSongId && photoId && (
              <Button
                onClick={goEditOnly}
                className="w-full h-12 rounded-full bg-white text-black hover:bg-white/90 font-medium"
              >
                저장 및 편집하기
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Playlist drawer */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 bg-black/95 backdrop-blur-xl rounded-t-3xl transition-transform duration-300 ${
          showPlaylist ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ maxHeight: "70vh" }}
      >
        <div className="p-4">
          <div className="w-12 h-1 bg-white/30 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-lg">플레이리스트</h3>
            <button onClick={() => setShowPlaylist(false)} className="text-white/60 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(70vh - 100px)" }}>
            <div className="space-y-2">
              {recommendations.map((song, idx) => (
                <button
                  key={song.id}
                  onClick={() => onClickSong(song)}
                  disabled={busy}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${
                    currentSong?.id === song.id ? "bg-white/20" : "bg-white/5 hover:bg-white/10 active:bg-white/15"
                  }`}
                >
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
                    {song.image ? (
                      <Image
                        src={song.image || "/placeholder.svg"}
                        alt={song.title}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-6 h-6 text-white/40" />
                      </div>
                    )}
                    {currentSong?.id === song.id && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        {isPlaying ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white" />}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-white font-medium text-sm truncate">{song.title}</p>
                    <p className="text-white/60 text-xs truncate">{song.artist}</p>
                  </div>
                  <span className="text-white/40 text-xs flex-shrink-0">{song.duration}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showPlaylist && <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowPlaylist(false)} />}
    </div>
  );
}

function toBackendSongArray(val: unknown): BackendSong[] {
  if (!Array.isArray(val)) return [];
  return val.filter((x) => x && typeof x === "object") as BackendSong[];
}
