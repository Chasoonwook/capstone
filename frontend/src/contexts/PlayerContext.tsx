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

/** 트랙 모델 (필요시 필드 추가 가능) */
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

// 재생 가능 여부(현재는 미리듣기 URL 존재 여부)
function isPlayable(t?: Track) {
  return !!t?.audioUrl;
}

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

  /** 오디오 엘리먼트 보장 (앱 생명주기 동안 1개만) */
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
      a.addEventListener("error", () => {
        // 재생 오류가 나도 자동으로 다음 곡으로 튀지 않게 멈춤
        setIsPlaying(false);
      });

      audioRef.current = a;
    }
    return audioRef.current!;
  };

  /** 현재 리스트에서 start 이상에서 처음 재생 가능한 인덱스 반환 (없으면 -1) */
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

  /** 현재 리스트에서 start 이하에서 뒤로 처음 재생 가능한 인덱스 반환 (없으면 -1) */
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

  /** 현재 index 트랙을 로드(+옵션 자동 재생) */
  const loadAndMaybePlay = useCallback(
    async (autoPlay = false) => {
      const a = ensureAudio();

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
      }

      if (autoPlay) {
        try {
          await a.play();
          setIsPlaying(true);
        } catch {
          // 오토플레이 차단 시 사용자가 Play 버튼 누르면 시작됨
          setIsPlaying(false);
        }
      }
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
    setState((s) => {
      const ni = (() => {
        for (let i = s.index + 1; i < s.queue.length; i++) {
          if (isPlayable(s.queue[i])) return i;
        }
        return s.index; // 못 찾으면 그대로
      })();
      return { ...s, index: ni, curMs: 0 };
    });
  }, []);

  const prev = useCallback(() => {
    const a = ensureAudio();
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

  /** ─────────────────────────────────────────────
   *  동일 큐/동일 시작 인덱스면 no-op (리셋 루프 차단)
   *  ──────────────────────────────────────────── */
  const lastSigRef = useRef<string>("");
  const setQueueFromRecommend = useCallback((tracks: Track[], startIndex = 0) => {
    // 시작 인덱스부터 첫 재생 가능 곡을 찾음 → 없으면 처음부터 재탐색
    let si = startIndex;
    while (si < tracks.length && !isPlayable(tracks[si])) si++;
    if (si >= tracks.length) {
      si = 0;
      while (si < tracks.length && !isPlayable(tracks[si])) si++;
      if (si >= tracks.length) si = 0; // 전부 불가
    }

    const ids = (tracks || []).map((t) => String(t?.id ?? "")).join("|");
    const sig = `${ids}#${si}`;
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;

    setState({ queue: tracks, index: si, curMs: 0, durMs: 0 });
  }, []);

  /** index 또는 queue가 바뀌면 자동 로드(+자동재생) */
  const idx = state.index;
  const qkey = useMemo(() => state.queue.map((t) => t.id).join(","), [state.queue]);
  useEffect(() => {
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
