// src/contexts/PlayerContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSpotifyStatus } from "./SpotifyStatusContext";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";
import { API_BASE } from "@/lib/api";

/** 트랙 모델 */
export type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;           // 30초 미리듣기 (Spotify preview / Deezer / iTunes)
  spotify_uri?: string | null;        // spotify:track:<id>
  coverUrl?: string | null;
  duration?: number | null;           // 초 단위 (미리듣기일 때는 보통 null)
  // ✅ "diary" 추가 (+ 검색/추천에서도 쓸 수 있게 search/recommend 확장)
  selected_from?: "main" | "sub" | "preferred" | "search" | "recommend" | "diary" | null;
  spotify_track_id?: string | null;   // 순수 ID만
};

export type PlayerState = {
  queue: Track[];
  index: number;                      // 현재 인덱스
  curMs: number;                      // 현재 재생 위치(ms)
  durMs: number;                      // 전체 길이(ms)
  currentTrack: Track | null;
  playbackSource: "preview" | "spotify" | null;
};

type Ctx = {
  state: PlayerState;
  isPlaying: boolean;
  volume: number;
  isSpotifyReady: boolean;

  play: (track?: Track, index?: number, startFromBeginning?: boolean) => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  setQueueAndPlay: (tracks: Track[], startIndex?: number) => void;
};

const PlayerCtx = createContext<Ctx | null>(null);

/* =======================
   공통 유틸 (검색 중복/실패 캐시/스로틀)
   ======================= */
const inflightMap = new Map<string, Promise<Track>>();
const failCache = new Map<string, number>();
const FAIL_TTL_MS = 3 * 60 * 1000;
const MIN_GAP_MS = 800;
let lastHit = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeFetchJson(url: string, init?: RequestInit) {
  try {
    const resp = await fetch(url, init);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * 주어진 Track을 기반으로 재생 가능한 소스를 해결한다.
 * 우선순위:
 * 1) Spotify: id/uri 보강 (전체 재생 가능)
 * 2) 미리듣기: Spotify preview → Deezer preview → iTunes preview
 * - 백엔드에 /api/spotify/search, /api/deezer/search, /api/itunes/search 가 있다면 활용.
 * - 없으면 가능한 것만 반영.
 */
async function resolvePlayableSource(t: Track): Promise<Track> {
  if (!t || (!t.title && !t.spotify_track_id && !t.spotify_uri)) return t;

  // 이미 결정된 정보가 풍부하면 그대로 반환
  if (t.spotify_uri || t.spotify_track_id || t.audioUrl) return t;

  const key = `${t.title}|${t.artist ?? ""}`.trim().toLowerCase();
  const lastFail = failCache.get(key) || 0;
  if (Date.now() - lastFail < FAIL_TTL_MS) return t;

  const inflight = inflightMap.get(key);
  if (inflight) {
    const merged = await inflight;
    return { ...t, ...merged };
  }

  const p = (async (): Promise<Track> => {
    const gap = Date.now() - lastHit;
    if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);
    lastHit = Date.now();

    const qs = new URLSearchParams({
      ...(t.title ? { title: t.title } : {}),
      ...(t.artist ? { artist: t.artist } : {}),
      limit: "1",
    });

    let out: Track = { ...t };

    // 1) Spotify 검색: id/uri + preview_url + cover
    {
      const data = await safeFetchJson(`${API_BASE}/api/spotify/search?${qs.toString()}`, {
        credentials: "include",
      });
      const item =
        data?.tracks?.items?.[0] || data?.items?.[0] || data?.[0] || null;

      if (item) {
        const sid = item?.id || item?.trackId || item?.spotify_track_id || null;
        const preview = item?.preview_url ?? null;
        const cover =
          item?.album?.images?.[0]?.url || item?.albumImage || item?.coverUrl || null;

        if (sid && !out.spotify_track_id) out.spotify_track_id = String(sid);
        if (!out.spotify_uri && sid) out.spotify_uri = `spotify:track:${sid}`;
        if (!out.audioUrl && preview) out.audioUrl = preview;
        if (!out.coverUrl && cover) out.coverUrl = cover;
      }
    }

    // 2) Deezer 검색: 30초 미리듣기 preview, cover
    if (!out.audioUrl) {
      const data = await safeFetchJson(`${API_BASE}/api/deezer/search?${qs.toString()}`, {
        credentials: "include",
      });
      const item =
        data?.data?.[0] || data?.items?.[0] || data?.[0] || null;

      if (item) {
        const preview =
          item?.preview || item?.audioUrl || null; // deezer preview mp3
        const cover =
          item?.album?.cover_big ||
          item?.album?.cover_medium ||
          item?.album?.cover ||
          item?.albumCover ||
          null;
        if (!out.audioUrl && preview) out.audioUrl = preview;
        if (!out.coverUrl && cover) out.coverUrl = cover;
      }
    }

    // 3) iTunes 검색: 30초 미리듣기 previewUrl, cover
    if (!out.audioUrl) {
      const data = await safeFetchJson(`${API_BASE}/api/itunes/search?${qs.toString()}`, {
        credentials: "include",
      });
      const item =
        data?.results?.[0] || data?.items?.[0] || data?.[0] || null;

      if (item) {
        const preview =
          item?.previewUrl || item?.preview_url || item?.audioUrl || null;
        const cover =
          item?.artworkUrl100 ||
          item?.artworkUrl60 ||
          item?.coverUrl ||
          null;
        if (!out.audioUrl && preview) out.audioUrl = preview;
        if (!out.coverUrl && cover) out.coverUrl = cover;
      }
    }

    if (!out.audioUrl && !out.spotify_uri && !out.spotify_track_id) {
      failCache.set(key, Date.now());
    }
    return out;
  })();

  inflightMap.set(key, p);
  try {
    const resolved = await p;
    return resolved;
  } finally {
    inflightMap.delete(key);
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Spotify 연결 상태
  const { status: spotifyStatus } = useSpotifyStatus();
  const spotifyPlayer = useSpotifyPlayer();
  const isSpotifyConnected = spotifyStatus.connected && spotifyPlayer.ready;

  const [state, setState] = useState<PlayerState>({
    queue: [],
    index: -1,
    curMs: 0,
    durMs: 0,
    currentTrack: null,
    playbackSource: null,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, _setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 0.8;
    const v = Number(localStorage.getItem("player_volume") || "0.8");
    return isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
  });

  const suppressAutoPlayRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "metadata";
      a.volume = volume;

      a.addEventListener("timeupdate", () => {
        if (state.playbackSource === "preview") {
          setState((s) => ({ ...s, curMs: a.currentTime * 1000 }));
        }
      });
      a.addEventListener("loadedmetadata", () => {
        if (state.playbackSource === "preview") {
          const dur = a.duration && isFinite(a.duration) ? a.duration * 1000 : 0;
          setState((s) => ({ ...s, durMs: dur }));
        }
      });
      a.addEventListener("error", (e) => {
        console.error("Audio Element Error:", e);
        if (state.playbackSource === "preview") setIsPlaying(false);
      });
      audioRef.current = a;
    }
    return audioRef.current!;
  }, [volume, state.playbackSource]);

  // Spotify SDK 상태 → PlayerState 반영
  useEffect(() => {
    if (isSpotifyConnected && state.playbackSource === "spotify") {
      setState((s) => ({
        ...s,
        curMs: spotifyPlayer.state.position,
        durMs: spotifyPlayer.state.duration,
      }));
      setIsPlaying(!spotifyPlayer.state.paused);
    }
  }, [spotifyPlayer.state, isSpotifyConnected, state.playbackSource]);

  const play = useCallback(
    async (track?: Track, index?: number, startFromBeginning = true) => {
      // 1. 재생 대상 트랙과 인덱스 확정
      const baseTrack = track ?? state.queue[index ?? state.index];
      const targetIndex = index ?? state.index;
      if (!baseTrack) {
        console.log("[PlayerContext] Play cancelled: No base track found.");
        return;
      }

      if (
        state.currentTrack?.id === baseTrack.id && // 현재 재생 중인 트랙 ID와 같고
        isPlaying && // 현재 '재생 중' 상태이며
        !startFromBeginning // 처음부터 다시 재생하는 경우가 아니라면
      ) {
        console.log("[PlayerContext] Play cancelled: Already playing the same track.");
        return; // 함수 실행을 여기서 중단하여 불필요한 API 호출 방지
      }

      // 이전 소스 정지
      try {
        if (state.playbackSource === "spotify" && spotifyPlayer.ready && !spotifyPlayer.state.paused) {
          await spotifyPlayer.pause();
        } else if (state.playbackSource === "preview" && audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
          if (startFromBeginning) audioRef.current.currentTime = 0;
        }
        await wait(40);
      } catch (e) {
        console.error("Error pausing previous track:", e);
      }

      // 🔎 소스 해상(Spotify/Preview) 정보 보강
      const targetTrack = await resolvePlayableSource(baseTrack);

      // ✅ 정책: Spotify 로그인 연결 시엔 가능하면 무조건 Spotify 전체듣기 우선
      const hasSpotify = !!(targetTrack.spotify_uri || targetTrack.spotify_track_id);
      const preferSpotify = isSpotifyConnected && hasSpotify;

      // 최종 소스 결정
      const source: "spotify" | "preview" | null =
        preferSpotify
          ? "spotify"
          : targetTrack.audioUrl
          ? "preview"
          : null;

      // 상태 먼저 반영
      setState((s) => ({
        ...s,
        index: targetIndex,
        currentTrack: targetTrack,
        playbackSource: source,
        curMs: startFromBeginning ? 0 : s.curMs,
        durMs:
          startFromBeginning || source !== s.playbackSource
            ? targetTrack.duration
              ? targetTrack.duration * 1000
              : s.durMs // 미리듣기는 loadedmetadata에서 갱신
            : s.durMs,
      }));

      // 실제 재생
      let playInitiated = false;

      if (source === "spotify") {
        const uri =
          targetTrack.spotify_uri ||
          (targetTrack.spotify_track_id
            ? `spotify:track:${targetTrack.spotify_track_id}`
            : null);
        if (uri) {
          try {
            await spotifyPlayer.playUris([uri]);
            setIsPlaying(true);
            playInitiated = true;
          } catch (e) {
            console.error("Spotify playUris failed:", e);
            setIsPlaying(false);
          }
        } else {
          console.warn("[PlayerContext] Spotify source selected but no valid URI found.");
        }
      }

      if (!playInitiated && source === "preview" && targetTrack.audioUrl) {
        const a = ensureAudio();
        const newSrc = targetTrack.audioUrl;
        const shouldLoad = a.src !== newSrc;

        if (shouldLoad) {
          a.src = newSrc;
          a.load();
        }

        const targetTime =
          startFromBeginning || shouldLoad ? 0 : state.curMs / 1000;

        try {
          if (a.seekable.length > 0) {
            a.currentTime = targetTime;
          } else if (targetTime !== 0) {
            a.currentTime = 0;
          }
        } catch (e) {
          console.error("Error setting currentTime:", e);
          a.currentTime = 0;
        }

        try {
          await a.play();
          setIsPlaying(true);
          playInitiated = true;
        } catch (err) {
          console.error("Preview play failed:", err);
          setIsPlaying(false);
        }
      }

      if (!playInitiated) {
        console.warn("No playable source initiated for track:", targetTrack.title);
        setIsPlaying(false);
        setState((s) => {
          const nextIndex = s.index + 1;
          if (nextIndex < s.queue.length) {
            return {
              ...s,
              index: nextIndex,
              currentTrack: s.queue[nextIndex],
              curMs: 0,
            };
          }
          return { ...s, index: -1, currentTrack: null, curMs: 0 };
        });
      }
    },
    [
      state.queue,
      state.index,
      state.playbackSource,
      state.curMs,
      isSpotifyConnected,
      spotifyPlayer,
      ensureAudio,
      setIsPlaying,
      state.currentTrack,
      isPlaying,
    ]
  );

  const pause = useCallback(async () => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      await spotifyPlayer.pause();
      setIsPlaying(false);
    } else if (state.playbackSource === "preview" && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [state.playbackSource, spotifyPlayer]);

  const seek = useCallback(
    (ms: number) => {
      if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
        spotifyPlayer.seek(ms);
      } else if (state.playbackSource === "preview" && audioRef.current) {
        const a = audioRef.current;
        const targetTime = Math.max(0, ms / 1000);
        const duration =
          a.duration && isFinite(a.duration) ? a.duration : state.durMs / 1000;

        if (a.seekable.length > 0 && targetTime <= duration) {
          a.currentTime = Math.min(targetTime, duration > 0 ? duration - 0.01 : 0);
          setState((s) => ({ ...s, curMs: a.currentTime * 1000 }));
        } else {
          console.warn("Seek ignored: invalid time or media not seekable.");
        }
      }
    },
    [state.playbackSource, spotifyPlayer, state.durMs]
  );

  const resume = useCallback(async () => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      await spotifyPlayer.resume();
      setIsPlaying(true);
    } else if (state.playbackSource === "preview" && audioRef.current) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.error("Preview resume failed:", err);
        setIsPlaying(false);
      }
    } else if (state.currentTrack) {
      // 안전 폴백
      suppressAutoPlayRef.current = true;
      await play(state.currentTrack, state.index, false);
      suppressAutoPlayRef.current = false;
    }
  }, [
    state.playbackSource,
    spotifyPlayer,
    state.currentTrack,
    state.index,
    state.curMs,
    play,
  ]);

  const togglePlayPause = useCallback(
    async () => {
      if (isPlaying) await pause();
      else await resume();
    },
    [isPlaying, pause, resume]
  );

  const next = useCallback(() => {
    const currentIdx = state.index;
    const currentQueue = state.queue;
    if (!currentQueue || currentQueue.length === 0) return;
    const nextIndex = currentIdx + 1;

    if (nextIndex >= currentQueue.length) {
      setIsPlaying(false);
      setState((s) => ({ ...s, curMs: 0, index: -1, currentTrack: null }));
      return;
    }

    const nextTrack = currentQueue[nextIndex];
    if (nextTrack) {
      void play(nextTrack, nextIndex, true);
    }
  }, [state.index, state.queue, play, setIsPlaying]);

  const prev = useCallback(() => {
    const currentMs = state.curMs;
    const currentIdx = state.index;
    const currentQueue = state.queue;

    // 3초 이상 재생했거나 첫 곡이면 현재 곡 처음으로
    if (currentMs > 3000 || currentIdx === 0) {
      seek(0);
      if (!isPlaying) {
        void resume();
      }
      return;
    }

    const prevIndex = Math.max(0, state.index - 1);
    if (currentQueue[prevIndex]) {
      const prevTrack = currentQueue[prevIndex];
      void play(prevTrack, prevIndex, true);
    } else {
      seek(0);
      if (!isPlaying) void resume();
    }
  }, [state.curMs, state.index, state.queue, isPlaying, seek, resume, play]);

  const setVolume = useCallback(
    (v: number) => {
      const vv = Math.min(1, Math.max(0, v));
      _setVolume(vv);

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("player_volume", String(vv));
        } catch {}
      }

      if (audioRef.current) audioRef.current.volume = vv;
      if (spotifyPlayer.ready) {
        spotifyPlayer.setVolume(vv);
      }
    },
    [spotifyPlayer]
  );

  const setQueueAndPlay = useCallback(
    (tracks: Track[], startIndex = 0) => {
      const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const firstTrack = tracks[safeIndex] || null;

      if (isPlaying) {
        void pause();
      }

      setState((s) => ({
        ...s,
        queue: tracks,
        index: safeIndex,
        currentTrack: firstTrack,
        curMs: 0,
        durMs: firstTrack?.duration ? firstTrack.duration * 1000 : 0,
        playbackSource: null,
      }));

      setTimeout(() => {
        void play(firstTrack!, safeIndex, true);
      }, 50);
    },
    [isPlaying, pause, play]
  );

  // 미리듣기 종료 → 다음 곡
  useEffect(() => {
    const a = ensureAudio();
    const handleEnded = () => {
      if (state.playbackSource === "preview") next();
    };
    a.addEventListener("ended", handleEnded);
    return () => a.removeEventListener("ended", handleEnded);
  }, [ensureAudio, state.playbackSource, next]);

  const ctx: Ctx = useMemo(
    () => ({
      state,
      isPlaying,
      volume,
      isSpotifyReady: spotifyPlayer.ready,
      togglePlayPause,
      play,
      pause,
      next,
      prev,
      seek,
      setVolume,
      setQueueAndPlay,
    }),
    [
      state,
      isPlaying,
      volume,
      spotifyPlayer,
      play,
      pause,
      togglePlayPause,
      next,
      prev,
      seek,
      setVolume,
      setQueueAndPlay,
    ]
  );

  useEffect(() => {
    ensureAudio();
  }, [ensureAudio]);

  return <PlayerCtx.Provider value={ctx}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
