"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

/** 트랙 모델 (필요시 필드 추가 가능) */
export type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;
};

export type PlayerState = {
  queue: Track[];
  index: number;
  curMs: number;
  durMs: number;
};

type Ctx = {
  /** 현재 플레이어 상태 */
  state: PlayerState;
  /** 재생중 여부 */
  isPlaying: boolean;
  /** 볼륨(0~1) */
  volume: number;

  /** 재생/일시정지/탐색/볼륨/이동 제어 */
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;

  /** 추천 페이지에서 큐 설정 */
  setQueueFromRecommend: (tracks: Track[], startIndex?: number) => void;
};

const PlayerCtx = createContext<Ctx | null>(null);

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

  /** 오디오 엘리먼트 보장 */
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
      });

      a.addEventListener("loadedmetadata", () => {
        setState((s) => ({
          ...s,
          durMs: a.duration ? a.duration * 1000 : s.durMs,
        }));
      });

      a.addEventListener("ended", () => next());
      audioRef.current = a;
    }
    return audioRef.current!;
  };

  /** 현재 index 트랙을 로드(+옵션 자동 재생) */
  const loadAndMaybePlay = useCallback(
    async (autoPlay = false) => {
      const a = ensureAudio();
      const t = state.queue[state.index];
      if (!t?.audioUrl) return;
      a.src = t.audioUrl;
      await a.load();

      if (autoPlay) {
        try {
          await a.play();
          setIsPlaying(true);
        } catch {}
      }
    },
    [state.queue, state.index],
  );

  const play = useCallback(async () => {
    const a = ensureAudio();
    try {
      await a.play();
      setIsPlaying(true);
    } catch {}
  }, []);

  const pause = useCallback(async () => {
    const a = ensureAudio();
    a.pause();
    setIsPlaying(false);
  }, []);

  const next = useCallback(() => {
    setState((s) => {
      const nextIndex = s.index + 1 < s.queue.length ? s.index + 1 : s.index;
      return { ...s, index: nextIndex, curMs: 0 };
    });
  }, []);

  const prev = useCallback(() => {
    const a = ensureAudio();
    setState((s) => {
      if (a.currentTime > 3) {
        a.currentTime = 0;
        return { ...s, curMs: 0 };
      }
      const prevIndex = s.index > 0 ? s.index - 1 : 0;
      return { ...s, index: prevIndex, curMs: 0 };
    });
  }, []);

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

  const setQueueFromRecommend = useCallback((tracks: Track[], startIndex = 0) => {
    setState({ queue: tracks, index: startIndex, curMs: 0, durMs: 0 });
  }, []);

  // index 또는 queue가 바뀌면 자동 로드(+재생)
  const idx = state.index;
  const qkey = state.queue.map((t) => t.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => {
    void loadAndMaybePlay(true);
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
