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
  audioUrl?: string | null;           // 30초 미리듣기
  spotify_uri?: string | null;        // spotify:track:<id>
  coverUrl?: string | null;
  duration?: number | null;           // 초
  selected_from?: "main" | "sub" | "preferred" | null;
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

  play: (track?: Track, index?: number) => Promise<void>;
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
   검색 중복 방지/실패 캐시/스로틀
   ======================= */
const inflightMap = new Map<string, Promise<Track>>(); // 동일 키 1-flight
const failCache = new Map<string, number>();           // 실패 키 -> ts
const FAIL_TTL_MS = 3 * 60 * 1000;                     // 실패 3분 동안 재검색 금지
const MIN_GAP_MS = 800;                                 // 호출 간 최소 간격(스로틀)
let lastHit = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 재생 직전, 프리뷰/Spotify ID 없으면 1회만 검색해서 보강 */
async function resolvePlayableSource(t: Track): Promise<Track> {
  if (!t || t.audioUrl || t.spotify_uri || t.spotify_track_id || !t.title) return t;

  const key = `${t.title}|${t.artist ?? ""}`.trim().toLowerCase();

  // 최근 실패한 곡은 건너뜀(429 폭주 방지)
  const lastFail = failCache.get(key) || 0;
  if (Date.now() - lastFail < FAIL_TTL_MS) return t;

  // 동일 키 요청 진행 중이면 그 결과 재사용(1-flight)
  const inflight = inflightMap.get(key);
  if (inflight) return { ...t, ...(await inflight) };

  const p = (async (): Promise<Track> => {
    // 스로틀: 호출 간 최소 간격 보장
    const gap = Date.now() - lastHit;
    if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);

    const qs = new URLSearchParams({
      title: t.title,
      ...(t.artist ? { artist: t.artist } : {}),
      limit: "1",
    });

    let data: any = null;

    // 과도 재시도 금지: 1회만 시도
    lastHit = Date.now();
    const resp = await fetch(`${API_BASE}/api/spotify/search?${qs.toString()}`, {
      credentials: "include",
    }).catch(() => null);

    if (resp?.ok) {
      data = await resp.json();
    } else {
      // 429/기타 실패 → 부정 캐시 기록
      failCache.set(key, Date.now());
      return t;
    }

    const item =
      data?.tracks?.items?.[0] ||
      data?.items?.[0] ||
      data?.[0] ||
      null;

    if (!item) {
      failCache.set(key, Date.now());
      return t;
    }

    const preview =
      item?.preview_url || item?.previewUrl || item?.audioUrl || null;
    const cover =
      item?.album?.images?.[0]?.url || item?.albumImage || item?.coverUrl || null;
    const sid =
      item?.id || item?.trackId || item?.spotify_track_id || null;

    return {
      ...t,
      audioUrl: preview ?? t.audioUrl ?? null,
      coverUrl: cover ?? t.coverUrl ?? null,
      spotify_track_id: sid ?? t.spotify_track_id ?? null,
      spotify_uri: sid ? `spotify:track:${sid}` : (t.spotify_uri ?? null),
    };
  })();

  inflightMap.set(key, p);
  try {
    return await p;
  } finally {
    inflightMap.delete(key);
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
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

  // 인덱스 변경 useEffect의 자동 호출을 억제(중복 play 방지)
  const suppressAutoPlayRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      console.log("Creating Audio element for previews");
      const a = new Audio();
      a.preload = "metadata";
      a.volume = volume;

      a.addEventListener("timeupdate", () => {
        if (state.playbackSource === "preview") {
          setState((s) => ({
            ...s,
            curMs: a.currentTime * 1000,
            durMs:
              a.duration && isFinite(a.duration) ? a.duration * 1000 : s.durMs,
          }));
        }
      });
      a.addEventListener("loadedmetadata", () => {
        if (state.playbackSource === "preview") {
          setState((s) => ({
            ...s,
            durMs:
              a.duration && isFinite(a.duration) ? a.duration * 1000 : s.durMs,
          }));
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

  // Spotify 상태 동기화
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

  const next = useCallback(() => {
    setState((s) => {
      if (!s.queue || s.queue.length === 0) return s;
      const nextIndex = s.index + 1;
      if (nextIndex >= s.queue.length) {
        console.log("End of queue reached");
        setIsPlaying(false);
        return { ...s, curMs: 0 };
      }
      const nextTrack = s.queue[nextIndex];
      return { ...s, index: nextIndex, currentTrack: nextTrack, curMs: 0 };
    });
  }, []);

  const play = useCallback(
    async (track?: Track, index?: number) => {
      const baseTrack = track ?? state.queue[index ?? state.index];
      const targetIndex = index ?? state.index;
      if (!baseTrack) return;

      // 1) 소스 보강 (과도 재시도/중복 호출 차단됨)
      const targetTrack = await resolvePlayableSource(baseTrack);

      // 2) 소스 결정
      const hasSpotify =
        !!(targetTrack.spotify_uri || targetTrack.spotify_track_id);
      const canPlaySpotify = isSpotifyConnected && hasSpotify;
      const source: "spotify" | "preview" | null = canPlaySpotify
        ? "spotify"
        : targetTrack.audioUrl
        ? "preview"
        : null;

      console.log(
        `Play request: ${targetTrack.title} (Source: ${source || "None"})`
      );

      // 상태 업데이트
      setState((s) => ({
        ...s,
        index: targetIndex,
        currentTrack: targetTrack,
        playbackSource: source,
      }));

      // 다른 소스 정지
      if (source === "spotify" && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (
        source === "preview" &&
        spotifyPlayer.ready &&
        !spotifyPlayer.state.paused
      ) {
        await spotifyPlayer.pause();
      }

      // 3) 실제 재생
      if (source === "spotify") {
        const uri =
          targetTrack.spotify_uri ||
          (targetTrack.spotify_track_id
            ? `spotify:track:${targetTrack.spotify_track_id}`
            : null);
        if (uri) {
          await spotifyPlayer.playUris([uri]);
          setIsPlaying(true);
          return;
        }
      }

      if (source === "preview") {
        const a = ensureAudio();
        if (a.src !== targetTrack.audioUrl) {
          a.src = targetTrack.audioUrl!;
          a.load();
        }
        try {
          await a.play();
          setIsPlaying(true);
          return;
        } catch (err) {
          console.error("Preview play failed:", err);
          setIsPlaying(false);
        }
      }

      // 4) 둘 다 없으면 재시도 없이 바로 다음 곡으로 (폭주 차단)
      console.warn("No playable source for track:", targetTrack.title);
      setIsPlaying(false);
      next();
    },
    [
      state.index,
      state.queue,
      isSpotifyConnected,
      spotifyPlayer,
      ensureAudio,
      next,
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

  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      await pause();
    } else {
      await play(
        state.currentTrack ?? state.queue[0],
        state.index === -1 ? 0 : state.index
      );
    }
  }, [isPlaying, pause, play, state.currentTrack, state.index, state.queue]);

  const prev = useCallback(() => {
    if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
      spotifyPlayer.prev();
      return;
    }
    if (state.playbackSource === "preview" && audioRef.current) {
      const a = audioRef.current;
      if (a.currentTime > 3) {
        a.currentTime = 0;
        setState((s) => ({ ...s, curMs: 0 }));
        if (!isPlaying) play();
      } else {
        setState((s) => {
          const prevIndex = Math.max(0, s.index - 1);
          const prevTrack = s.queue[prevIndex];
          return { ...s, index: prevIndex, currentTrack: prevTrack, curMs: 0 };
        });
      }
    }
  }, [state.playbackSource, spotifyPlayer, isPlaying, play, state.queue]);

  const seek = useCallback(
    (ms: number) => {
      if (state.playbackSource === "spotify" && spotifyPlayer.ready) {
        spotifyPlayer.seek(ms);
      } else if (state.playbackSource === "preview" && audioRef.current) {
        const a = audioRef.current;
        const targetTime = Math.max(0, ms / 1000);
        const duration =
          a.duration && isFinite(a.duration) ? a.duration : state.durMs / 1000;
        a.currentTime = Math.min(
          targetTime,
          duration > 0 ? duration - 0.1 : 0
        );
      }
    },
    [state.playbackSource, spotifyPlayer, state.durMs]
  );

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
      if (isSpotifyConnected) {
        spotifyPlayer.setVolume(vv);
      }
    },
    [isSpotifyConnected, spotifyPlayer]
  );

  const setQueueAndPlay = useCallback(
    (tracks: Track[], startIndex = 0) => {
      const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const firstTrack = tracks[safeIndex] || null;

      if (isPlaying) pause();

      // 인덱스 변경 hook의 자동 재생을 잠시 억제(중복 호출 방지)
      suppressAutoPlayRef.current = true;

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
        void play(firstTrack, safeIndex);
        suppressAutoPlayRef.current = false;
      }, 50);
    },
    [isPlaying, pause, play]
  );

  // preview ended → next
  useEffect(() => {
    const a = ensureAudio();
    const handleEnded = () => {
      if (state.playbackSource === "preview") next();
    };
    a.addEventListener("ended", handleEnded);
    return () => a.removeEventListener("ended", handleEnded);
  }, [ensureAudio, state.playbackSource, next]);

  // 인덱스 변경 시 자동 재생 (setQueueAndPlay 직후엔 억제)
  useEffect(() => {
    const track = state.queue[state.index];
    if (suppressAutoPlayRef.current) return;
    if (track && state.currentTrack?.id !== track.id) {
      void play(track, state.index);
    }
  }, [state.index, state.queue, play, state.currentTrack]);

  const ctx: Ctx = useMemo(
    () => ({
      state,
      isPlaying,
      volume,
      isSpotifyReady: spotifyPlayer.ready,
      play,
      pause,
      togglePlayPause,
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
      spotifyPlayer.ready,
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
