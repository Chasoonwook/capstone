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
import { createWebPlayer } from "../lib/spotifySdk";

/** 트랙 모델 */
export type Track = {
  id: string | number;
  title: string;
  artist: string;
  audioUrl?: string | null;     // 미리듣기
  spotify_uri?: string | null;  // 전체재생(SDK)
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
  seek: (ms: number) => void;   // SDK 모드에서는 noop
  setVolume: (v: number) => void;
  setQueueFromRecommend: (tracks: Track[], startIndex?: number) => void;
};

const PlayerCtx = createContext<Ctx | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // HTMLAudio (preview)
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

  /** Spotify 연결 여부 1회 확인 */
  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/api/spotify/status`, { credentials: "include" })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => mounted && setSpConnected(!!j?.connected))
      .catch(() => mounted && setSpConnected(false));
    return () => { mounted = false; };
  }, []);

  /** SDK 초기화 */
  useEffect(() => {
    let aborted = false;
    async function boot() {
      if (!spConnected) return;
      if (sdkPlayerRef.current && sdkDeviceId) return;

      try {
        const getOAuthToken = async () => {
          const r = await fetch(`${API_BASE}/api/spotify/token`, { credentials: "include" });
          const j = await r.json();
          if (!r.ok || !j?.access_token) throw new Error("token missing");
          return j.access_token as string;
        };

        const { player, deviceId } = await createWebPlayer({
          getOAuthToken, name: "MoodTune Web Player", volume,
        });
        if (aborted) { try { player.disconnect(); } catch {} ; return; }
        sdkPlayerRef.current = player;
        setSdkDeviceId(deviceId);
      } catch (e) {
        console.warn("[SDK] init failed → preview only", e);
      }
    }
    void boot();
    return () => { aborted = true; };
  }, [spConnected, volume, sdkDeviceId]);

  /** 현재 SDK 재생 가능 여부 */
  const isSpotifyMode = useCallback(() => {
    if (!spConnected || !sdkDeviceId) return false;
    const t = state.queue[state.index];
    return !!t?.spotify_uri;
  }, [spConnected, sdkDeviceId, state.queue, state.index]);

  /** HTMLAudio 보장 */
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
      a.addEventListener("ended", () => next());
      audioRef.current = a;
    }
    return audioRef.current!;
  }, [volume]); // next는 stable

  /** ▶ 재생 */
  const play = useCallback(async () => {
    if (isSpotifyMode()) {
      const t = state.queue[state.index];
      const uri = t?.spotify_uri;
      if (!sdkDeviceId || !uri) return;

      await fetch(`${API_BASE}/api/spotify/transfer`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: sdkDeviceId, play: true }),
      }).catch(() => {});

      await fetch(`${API_BASE}/api/spotify/play?device_id=${encodeURIComponent(sdkDeviceId)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [uri] }),
      }).catch(() => {});
      setIsPlaying(true);
      return;
    }

    const a = ensureAudio();
    const t = state.queue[state.index];
    if (!t?.audioUrl) return;
    try { await a.play(); setIsPlaying(true); }
    catch (e) { console.error("Preview play failed", e); setIsPlaying(false); }
  }, [isSpotifyMode, state.queue, state.index, sdkDeviceId, ensureAudio]);

  /** ⏯ 자동 로드(+옵션 재생) – play 를 위에서 선언했기 때문에 에러 없음 */
  const loadAndMaybePlay = useCallback(async (autoPlay = false) => {
    if (isSpotifyMode()) { if (autoPlay) await play(); return; }

    const a = ensureAudio();
    const t = state.queue[state.index];

    if (!t?.audioUrl) {
      a.src = "";
      setState((s) => ({ ...s, curMs: 0, durMs: 0 }));
      setIsPlaying(false);
      return;
    }

    if (a.src !== t.audioUrl) { a.src = t.audioUrl!; a.load(); }
    if (autoPlay) {
      try { await a.play(); setIsPlaying(true); }
      catch (e) { console.warn("Preview autoplay failed", e); setIsPlaying(false); }
    } else {
      if (!a.paused) a.pause();
      setIsPlaying(false);
    }
  }, [isSpotifyMode, ensureAudio, state.queue, state.index, play]);

  /** ⏸ */
  const pause = useCallback(async () => {
    if (isSpotifyMode()) {
      await fetch(`${API_BASE}/api/spotify/pause`, { method: "PUT", credentials: "include" }).catch(() => {});
      setIsPlaying(false);
      return;
    }
    const a = ensureAudio();
    a.pause();
    setIsPlaying(false);
  }, [isSpotifyMode, ensureAudio]);

  /** ⏭ */
  const next = useCallback(() => {
    if (isSpotifyMode()) {
      fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" }).catch(() => {});
    }
    setState((s) => ({ ...s, index: Math.min(s.index + 1, s.queue.length - 1), curMs: 0 }));
  }, [isSpotifyMode]);

  /** ⏮ */
  const prev = useCallback(() => {
    if (isSpotifyMode()) {
      fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" }).catch(() => {});
    } else {
      const a = ensureAudio();
      if (a.currentTime > 3) {
        a.currentTime = 0;
        setState((s) => ({ ...s, curMs: 0 }));
        return;
      }
    }
    setState((s) => ({ ...s, index: Math.max(0, s.index - 1), curMs: 0 }));
  }, [isSpotifyMode, ensureAudio]);

  /** ⏩ (SDK 모드에서는 noop) */
  const seek = useCallback((ms: number) => {
    if (isSpotifyMode()) return;
    const a = ensureAudio();
    const target = Math.max(0, ms / 1000);
    const duration = a.duration || state.durMs / 1000 || 0;
    a.currentTime = Math.min(target, duration > 0 ? duration - 0.1 : 0);
    setState((s) => ({ ...s, curMs: a.currentTime * 1000 }));
  }, [isSpotifyMode, ensureAudio, state.durMs]);

  const setVolume = useCallback((v: number) => {
    const vv = Math.min(1, Math.max(0, v));
    _setVolume(vv);
    try { localStorage.setItem("player_volume", String(vv)); } catch {}
    try { sdkPlayerRef.current?.setVolume?.(vv); } catch {}
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
  useEffect(() => { void loadAndMaybePlay(true); }, [idx, qkey, loadAndMaybePlay]);

  const ctx: Ctx = useMemo(
    () => ({
      state, isPlaying, volume,
      play, pause, next, prev, seek,
      setVolume, setQueueFromRecommend,
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
