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
import { API_BASE } from "@/lib/api";
import {
  createWebPlayer,
  transferToDevice,
  playUris,
  pausePlayback,
  nextTrack as sdkNext,
  prevTrack as sdkPrev,
} from "@/lib/spotifyClient";

/** 트랙 모델 */
export type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;     // 미리듣기용
  spotify_uri?: string | null;  // 전체재생용
};

export type PlayerState = {
  queue: Track[];
  index: number;
  curMs: number;
  durMs: number;
};

type Ctx = {
  state: PlayerState;
  isPlaying: boolean;
  volume: number;
  // 제어
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void; // (SDK 모드에서는 noop)
  setVolume: (v: number) => void;
  // 큐 주입
  setQueueFromRecommend: (tracks: Track[], startIndex?: number) => void;
};

const PlayerCtx = createContext<Ctx | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // HTMLAudio (preview fallback)
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Spotify SDK
  const sdkPlayerRef = useRef<any | null>(null);
  const [sdkDeviceId, setSdkDeviceId] = useState<string | null>(null);
  const [spConnected, setSpConnected] = useState<boolean>(false);

  const [state, setState] = useState<PlayerState>({
    queue: [],
    index: 0,
    curMs: 0,
    durMs: 0,
  });

  const [isPlaying, setIsPlaying] = useState(false);

  const [volume, _setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 0.8;
    const v = Number(localStorage.getItem("player_volume") || "0.8");
    return isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
  });

  /** Spotify 연결 여부 (쿠키 기반 상태) 1회 확인 */
  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/api/spotify/status`, { credentials: "include" })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!mounted) return;
        setSpConnected(!!j?.connected);
      })
      .catch(() => {
        if (!mounted) return;
        setSpConnected(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  /** SDK 초기화: 연결 + Premium이면 SDK 생성 → device_id 확보 */
  useEffect(() => {
    let aborted = false;

    async function bootSDK() {
      if (!spConnected) return; // 연결 안 됨 → 미리듣기만 사용
      try {
        // 이미 초기화 됐으면 스킵
        if (sdkPlayerRef.current && sdkDeviceId) return;

        const { player, deviceId } = await createWebPlayer({
          name: "MoodTune Web Player",
          volume,
        });

        if (aborted) {
          try {
            player.disconnect();
          } catch {}
          return;
        }

        sdkPlayerRef.current = player;
        setSdkDeviceId(deviceId);
      } catch (e) {
        console.warn("[SDK] init failed → preview fallback:", e);
      }
    }

    void bootSDK();
    return () => {
      aborted = true;
    };
  }, [spConnected, volume, sdkDeviceId]);

  /** 현재 SDK 모드로 재생 가능한지 */
  const isSpotifyMode = useCallback(() => {
    if (!spConnected || !sdkDeviceId) return false;
    const t = state.queue[state.index];
    return !!t?.spotify_uri;
  }, [spConnected, sdkDeviceId, state.queue, state.index]);

  /** HTMLAudio 보장(미리듣기) */
  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "metadata";
      a.volume = volume;

      a.addEventListener("timeupdate", () => {
        setState((s) => ({
          ...s,
          curMs: a.currentTime * 1000,
          durMs: a.duration ? a.duration * 1000 : s.durMs,
        }));
      });

      a.addEventListener("loadedmetadata", () => {
        setState((s) => ({
          ...s,
          durMs: a.duration ? a.duration * 1000 : s.durMs,
        }));
      });

      a.addEventListener("ended", () => {
        // 미리듣기 끝 → 다음 트랙
        next();
      });

      audioRef.current = a;
    }
    return audioRef.current!;
  }, [volume]);

  /** 현재 index 트랙을 로드(+옵션 자동 재생) */
  const loadAndMaybePlay = useCallback(
    async (autoPlay = false) => {
      // 1) SDK 가능한 경우: HTMLAudio 로드 불필요
      if (isSpotifyMode()) {
        if (autoPlay) await play();
        return;
      }

      // 2) Preview (HTMLAudio)
      const a = ensureAudio();
      const t = state.queue[state.index];

      if (!t?.audioUrl) {
        a.src = "";
        setState((s) => ({ ...s, curMs: 0, durMs: 0 }));
        setIsPlaying(false);
        return;
      }

      if (a.src !== t.audioUrl) {
        a.src = t.audioUrl!;
        a.load();
      }
      if (autoPlay) {
        try {
          await a.play();
          setIsPlaying(true);
        } catch (err) {
          console.warn("Preview autoplay failed:", err);
          setIsPlaying(false);
        }
      } else {
        if (!a.paused) a.pause();
        setIsPlaying(false);
      }
    },
    [isSpotifyMode, ensureAudio, state.queue, state.index],
  );

  /** 재생/일시정지/탐색/볼륨/이동 제어 */
  const play = useCallback(async () => {
    // SDK 모드: 해당 device로 transfer + play(uris)
    if (isSpotifyMode()) {
      const t = state.queue[state.index];
      const uri = t?.spotify_uri;
      if (!sdkDeviceId || !uri) return;

      await transferToDevice(sdkDeviceId, true).catch(() => {});
      await playUris([uri], sdkDeviceId).catch(() => {});
      setIsPlaying(true);
      return;
    }

    // Preview 모드
    const a = ensureAudio();
    const t = state.queue[state.index];
    if (!t?.audioUrl) return;
    try {
      await a.play();
      setIsPlaying(true);
    } catch (err) {
      console.error("Preview play failed:", err);
      setIsPlaying(false);
    }
  }, [isSpotifyMode, state.queue, state.index, sdkDeviceId, ensureAudio]);

  const pause = useCallback(async () => {
    if (isSpotifyMode()) {
      await pausePlayback().catch(() => {});
      setIsPlaying(false);
      return;
    }
    const a = ensureAudio();
    a.pause();
    setIsPlaying(false);
  }, [isSpotifyMode, ensureAudio]);

  const next = useCallback(() => {
    if (isSpotifyMode()) {
      sdkNext().catch(() => {});
    }
    setState((s) => ({
      ...s,
      index: Math.min(s.index + 1, s.queue.length - 1),
      curMs: 0,
    }));
  }, [isSpotifyMode]);

  const prev = useCallback(() => {
    if (isSpotifyMode()) {
      sdkPrev().catch(() => {});
    } else {
      const a = ensureAudio();
      if (a.currentTime > 3) {
        a.currentTime = 0;
        setState((s) => ({ ...s, curMs: 0 }));
        return;
      }
    }
    setState((s) => ({
      ...s,
      index: Math.max(0, s.index - 1),
      curMs: 0,
    }));
  }, [isSpotifyMode, ensureAudio]);

  const seek = useCallback(
    (ms: number) => {
      // SDK 시킹은 상태동기/레이트리밋 고려가 필요 → 일단 noop
      if (isSpotifyMode()) return;

      const a = ensureAudio();
      const target = Math.max(0, ms / 1000);
      const duration = a.duration || state.durMs / 1000 || 0;
      a.currentTime = Math.min(target, duration > 0 ? duration - 0.1 : 0);
      setState((s) => ({ ...s, curMs: a.currentTime * 1000 }));
    },
    [isSpotifyMode, ensureAudio, state.durMs],
  );

  const setVolume = useCallback((v: number) => {
    const vv = Math.min(1, Math.max(0, v));
    _setVolume(vv);
    try {
      localStorage.setItem("player_volume", String(vv));
    } catch {}
    // SDK 볼륨
    try {
      sdkPlayerRef.current?.setVolume?.(vv);
    } catch {}
    // HTMLAudio 볼륨
    if (audioRef.current) audioRef.current.volume = vv;
  }, []);

  /** 동일 큐 재주입 방지 */
  const lastSigRef = useRef<string>("");
  const setQueueFromRecommend = useCallback((tracks: Track[], startIndex = 0) => {
    const safeIndex = Math.max(0, Math.min(startIndex, (tracks?.length || 1) - 1));
    const ids = (tracks || []).map((t) => String(t?.id ?? "")).join("|");
    const sig = `${ids}#${safeIndex}`;
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;

    setState({ queue: tracks, index: safeIndex, curMs: 0, durMs: 0 });
    setIsPlaying(false);
  }, []);

  /** index/queue 변경 → 자동 로드(+재생) */
  const idx = state.index;
  const qkey = useMemo(() => state.queue.map((t) => t.id).join(","), [state.queue]);
  useEffect(() => {
    void loadAndMaybePlay(true);
  }, [idx, qkey, loadAndMaybePlay]);

  /** 컨텍스트 값 */
  const ctx: Ctx = useMemo(
    () => ({
      state,
      isPlaying,
      volume,
      play,
      pause,
      next,
      prev,
      seek,
      setVolume,
      setQueueFromRecommend,
    }),
    [state, isPlaying, volume, play, pause, next, prev, seek, setVolume, setQueueFromRecommend],
  );

  return <PlayerCtx.Provider value={ctx}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
