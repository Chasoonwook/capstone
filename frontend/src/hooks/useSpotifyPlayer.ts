"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/api";

/** 타입들 */
type ReadyEvent = { device_id: string };
type ErrorEvent = { message: string };
type WebPlaybackStateLite = {
  position: number;     // ms
  duration: number;     // ms
  paused: boolean;
  trackUri: string | null;
};
type TokenGetter = (cb: (token: string) => void) => void;
type PlayerOptions = { name: string; getOAuthToken: TokenGetter; volume?: number };
type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: "ready", cb: (ev: ReadyEvent) => void): void;
  addListener(event: "not_ready", cb: (ev: ReadyEvent) => void): void;
  addListener(
    event:
      | "initialization_error"
      | "authentication_error"
      | "account_error"
      | "playback_error",
    cb: (ev: ErrorEvent) => void
  ): void;
  addListener(event: "player_state_changed", cb: (state: any) => void): void;
  removeListener(event: string): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  seek(position_ms: number): Promise<void>;
  activateElement?: () => void | Promise<void>;
};
type SpotifyNS = { Player: new (opts: PlayerOptions) => SpotifyPlayer };
type SpotifyWindow = Window & {
  onSpotifyWebPlaybackSDKReady?: () => void;
  Spotify?: SpotifyNS;
};

/** SDK 로딩 */
async function ensureSDK(): Promise<void> {
  const w = window as unknown as SpotifyWindow;
  if (w.Spotify?.Player) return;
  if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.async = true;
    document.head.appendChild(s);
  }
  await new Promise<void>((resolve) => {
    const ww = window as unknown as SpotifyWindow;
    if (ww.Spotify?.Player) return resolve();
    ww.onSpotifyWebPlaybackSDKReady = () => resolve();
  });
}

/** 토큰(메모리 캐시) */
let memToken: { value: string; exp: number } | null = null;

async function fetchAccessToken(): Promise<{ access_token: string; expires_in?: number }> {
  const res = await fetch(`${API_BASE}/api/spotify/token`, {
    method: "GET",
    credentials: "include",
    headers: { "Cache-Control": "no-store" },
  });
  if (!res.ok) throw new Error(`/api/spotify/token ${res.status}`);
  return res.json();
}
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (memToken && now < memToken.exp - 30_000) return memToken.value;
  const data = await fetchAccessToken();
  const ttl = Math.max(60, Number(data.expires_in || 300));
  memToken = { value: data.access_token, exp: Date.now() + ttl * 1000 };
  return memToken.value;
}

/** 공용 fetch (쿠키 포함) */
async function call(endpoint: string, body?: any, method: "GET" | "POST" | "PUT" = "POST") {
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  };
  if (method !== "GET" && body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`${API_BASE}${endpoint}`, init);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${endpoint} ${r.status} ${txt}`.trim());
  }
  return r.json().catch(() => ({}));
}

/** Hook 본체 */
export function useSpotifyPlayer() {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [state, setState] = useState<WebPlaybackStateLite>({
    position: 0,
    duration: 0,
    paused: true,
    trackUri: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ensureSDK();
      if (cancelled || playerRef.current) return;

      const PlayerCtor = (window as unknown as SpotifyWindow).Spotify!.Player;

      const player = new PlayerCtor({
        name: "PhotoMoodMusic Web Player",
        volume: 0.7,
        getOAuthToken: async (cb) => {
          try {
            const token = await getAccessToken();
            cb(token);
          } catch (e) {
            console.error("[spotify] getOAuthToken failed:", e);
          }
        },
      });

      player.addListener("ready", (ev) => {
        deviceIdRef.current = ev.device_id;
        setDeviceId(ev.device_id);
        setReady(true);
      });
      player.addListener("not_ready", () => setReady(false));
      player.addListener("authentication_error", ({ message }) =>
        console.error("Auth Error:", message)
      );
      player.addListener("account_error", ({ message }) =>
        console.error("Account Error:", message)
      );
      player.addListener("playback_error", ({ message }) =>
        console.error("Playback Error:", message)
      );

      player.addListener("player_state_changed", (s: any) => {
        if (!s) return;
        setState({
          position: s.position || 0,
          duration: s.duration || 0,
          paused: !!s.paused,
          trackUri: s.track_window?.current_track?.uri ?? null,
        });
      });

      await player.connect();
      if (!cancelled) playerRef.current = player;
    })();

    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
      playerRef.current = null;
    };
  }, []);

  /** 보조 타이머: 재생 중일 때 1s마다 position 증가 (SDK 업데이트가 느릴 때 보정) */
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      setState((prev) => {
        if (!prev || prev.paused) return prev;
        const nextPos = Math.min(prev.duration, prev.position + 1000);
        return { ...prev, position: nextPos };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [ready]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const activate = useCallback(async () => {
    try {
      await playerRef.current?.activateElement?.();
    } catch {}
  }, []);

  const transferToThisDevice = useCallback(async () => {
    if (!deviceIdRef.current) throw new Error("no_device_id");
    await call("/api/spotify/transfer", { device_id: deviceIdRef.current, play: true }, "PUT");
    await sleep(300); // 전환 대기
  }, []);

  const playUris = useCallback(
    async (uris: string[]) => {
      if (!ready || !deviceIdRef.current) throw new Error("player_not_ready");
      await activate();
      await transferToThisDevice();
      await call(
        "/api/spotify/play",
        { device_id: deviceIdRef.current, uris, position_ms: 0 },
        "PUT",
      );
      // 재생 시작 시 position 초기화
      setState((p) => ({ ...p, position: 0, paused: false }));
    },
    [ready, activate, transferToThisDevice],
  );

  const resume = useCallback(async () => {
    if (!deviceIdRef.current) throw new Error("no_device_id");
    await call("/api/spotify/play", { device_id: deviceIdRef.current }, "PUT");
    setState((p) => ({ ...p, paused: false }));
  }, []);

  const pause = useCallback(async () => {
    await call("/api/spotify/pause", {}, "PUT");
    setState((p) => ({ ...p, paused: true }));
  }, []);

  const next = useCallback(async () => {
    await call("/api/spotify/next", {}, "POST");
    setState((p) => ({ ...p, position: 0 }));
  }, []);

  const prev = useCallback(async () => {
    await call("/api/spotify/previous", {}, "POST");
    setState((p) => ({ ...p, position: 0 }));
  }, []);

  const seek = useCallback(async (positionMs: number) => {
    await playerRef.current?.seek(Math.max(0, Math.floor(positionMs)));
    setState((p) => ({ ...p, position: Math.max(0, Math.floor(positionMs)) }));
  }, []);

  return {
    ready,
    deviceId,
    state,              // ms 단위
    activate,
    transferToThisDevice,
    playUris,
    resume,
    pause,
    next,
    prev,
    seek,
  };
}
