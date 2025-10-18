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

/** 트랙 모델 */
export type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null; // Spotify preview_url
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

  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;

  setQueueFromRecommend: (tracks: Track[], startIndex?: number) => void;
};

const PlayerCtx = createContext<Ctx | null>(null);

const isPlayable = (t?: Track) => !!t?.audioUrl;

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  /** 현재 로드 사이클 식별자(이벤트가 옛 src에서 온 것 무시) */
  const loadIdRef = useRef(0);
  /** 실제 재생이 시작되었는지(ended 스킵 방지) */
  const startedRef = useRef(false);
  /** 워치독 타이머 */
  const watchdogRef = useRef<number | null>(null);

  const clearWatchdog = () => {
    if (watchdogRef.current != null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const ensureAudio = () => {
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
        // 실제 재생이 0.5초 이상 진행되면 started
        if (a.currentTime >= 0.5) startedRef.current = true;
      });

      a.addEventListener("loadedmetadata", () => {
        setState((s) => ({
          ...s,
          durMs: a.duration ? a.duration * 1000 : s.durMs,
        }));
      });

      a.addEventListener("playing", () => {
        startedRef.current = true;
      });

      a.addEventListener("ended", () => {
        // 실제 재생된 적이 있어야만 다음 곡
        if (startedRef.current) next();
      });

      a.addEventListener("error", () => {
        // 오류는 정지로만 처리(워치독이 있으면 거기서 스킵)
        setIsPlaying(false);
      });

      audioRef.current = a;
    }
    return audioRef.current!;
  };

  /** 현재 리스트에서 start 이상 첫 재생가능 인덱스(-1: 없음) */
  const findNextPlayable = useCallback(
    (start: number) => {
      const q = state.queue;
      for (let i = Math.max(0, start); i < q.length; i++) {
        if (isPlayable(q[i])) return i;
      }
      return -1;
    },
    [state.queue]
  );

  /** 현재 리스트에서 start 이하 뒤로 첫 재생가능 인덱스(-1: 없음) */
  const findPrevPlayable = useCallback(
    (start: number) => {
      const q = state.queue;
      for (let i = Math.min(start, q.length - 1); i >= 0; i--) {
        if (isPlayable(q[i])) return i;
      }
      return -1;
    },
    [state.queue]
  );

  /** src 준비를 기다리는 유틸 */
  const waitForCanPlay = (a: HTMLAudioElement, id: number, timeoutMs = 2000) =>
    new Promise<void>((resolve, reject) => {
      let done = false;
      const onReady = () => {
        if (done || id !== loadIdRef.current) return;
        done = true;
        a.removeEventListener("canplaythrough", onReady);
        resolve();
      };
      const to = window.setTimeout(() => {
        if (done) return;
        done = true;
        a.removeEventListener("canplaythrough", onReady);
        reject(new Error("canplay timeout"));
      }, timeoutMs);
      a.addEventListener("canplaythrough", onReady, { once: true });
      // 빠르게 로드되어도 resolve
      if (a.readyState >= 3) {
        clearTimeout(to);
        a.removeEventListener("canplaythrough", onReady);
        resolve();
      }
    });

  /** 현재 index 트랙을 로드(+옵션 자동 재생) */
  const loadAndMaybePlay = useCallback(
    async (autoPlay = false) => {
      const a = ensureAudio();
      clearWatchdog();
      startedRef.current = false;
      const myId = ++loadIdRef.current;

      // 현재 인덱스가 재생 불가면 다음 재생 가능 곡으로 점프
      if (!isPlayable(state.queue[state.index])) {
        const ni = findNextPlayable(state.index + 1);
        if (ni === -1) {
          // 전체가 재생 불가 → 정지
          if (!a.paused) a.pause();
          setIsPlaying(false);
          setState((s) => ({ ...s, curMs: 0, durMs: 0 }));
          return;
        }
        setState((s) => ({ ...s, index: ni, curMs: 0 }));
        return;
      }

      const t = state.queue[state.index]!;
      if (a.src !== t.audioUrl) {
        a.src = t.audioUrl!;
        a.load();
      } else {
        a.currentTime = 0;
      }

      try {
        await waitForCanPlay(a, myId, 2000);
      } catch {
        // 준비가 안 되면 워치독으로 다음 곡 시도(2.5s)
      }

      if (autoPlay) {
        try {
          await a.play();
          setIsPlaying(true);
        } catch (err: any) {
          // 오토플레이 거절(NotAllowedError 등)은 스킵하지 말고 멈춤
          setIsPlaying(false);
        }
      }

      // 지연/깨진 미디어 워치독: 2.5s 내에 재생 시작되지 않으면 다음 곡
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        if (!startedRef.current && myId === loadIdRef.current) {
          next(); // 다음 재생 가능 곡으로
        }
      }, 2500);
    },
    [state.queue, state.index, findNextPlayable],
  );

  const play = useCallback(async () => {
    const a = ensureAudio();
    try {
      await a.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, []);

  const pause = useCallback(async () => {
    const a = ensureAudio();
    a.pause();
    setIsPlaying(false);
  }, []);

  const next = useCallback(() => {
    clearWatchdog();
    setState((s) => {
      const q = s.queue;
      let i = s.index + 1;
      while (i < q.length && !isPlayable(q[i])) i++;
      if (i >= q.length) i = s.index; // 못 찾으면 그대로
      return { ...s, index: i, curMs: 0 };
    });
  }, []);

  const prev = useCallback(() => {
    const a = ensureAudio();
    clearWatchdog();
    setState((s) => {
      if (a.currentTime > 3) {
        a.currentTime = 0;
        return { ...s, curMs: 0 };
      }
      const pi = findPrevPlayable(s.index - 1);
      return { ...s, index: pi === -1 ? 0 : pi, curMs: 0 };
    });
  }, [findPrevPlayable]);

  const seek = useCallback((ms: number) => {
    const a = ensureAudio();
    a.currentTime = Math.max(0, ms / 1000);
    setState((s) => ({ ...s, curMs: a.currentTime * 1000 }));
  }, []);

  const setVolume = useCallback((v: number) => {
    const vv = Math.min(1, Math.max(0, v));
    _setVolume(vv);
    if (typeof window !== "undefined") {
      localStorage.setItem("player_volume", String(vv));
    }
    if (audioRef.current) audioRef.current.volume = vv;
  }, []);

  /** 동일 큐/시작 인덱스면 no-op */
  const lastSigRef = useRef<string>("");
  const setQueueFromRecommend = useCallback((tracks: Track[], startIndex = 0) => {
    let si = startIndex;
    while (si < tracks.length && !isPlayable(tracks[si])) si++;
    if (si >= tracks.length) {
      si = 0;
      while (si < tracks.length && !isPlayable(tracks[si])) si++;
      if (si >= tracks.length) si = 0;
    }

    const ids = (tracks || []).map((t) => String(t?.id ?? "")).join("|");
    const sig = `${ids}#${si}`;
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;

    setState({ queue: tracks, index: si, curMs: 0, durMs: 0 });
  }, []);

  /** index/queue 변경 시 자동 로드(+자동재생) */
  const idx = state.index;
  const qkey = useMemo(() => state.queue.map((t) => t.id).join(","), [state.queue]);
  useEffect(() => {
    void loadAndMaybePlay(true);
    return () => clearWatchdog();
  }, [idx, qkey, loadAndMaybePlay]);

  const ctx: Ctx = {
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
  };

  return <PlayerCtx.Provider value={ctx}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
