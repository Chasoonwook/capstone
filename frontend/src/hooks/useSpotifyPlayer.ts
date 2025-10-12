// src/hooks/useSpotifyPlayer.ts
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/api";

/** ─ Types ─ */
type ReadyEvent = { device_id: string };
type ErrorEvent = { message: string };
type WebPlaybackStateLite = {
  position: number;
  duration: number;
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

// 전역 싱글톤 캐시(페이지 전환/재마운트에도 유지)
type G = Window & {
  __sp_player?: SpotifyPlayer | null;
  __sp_ready?: boolean;
  __sp_deviceId?: string | null;
};
const g = (typeof window !== "undefined" ? (window as unknown as G) : ({} as G));

/** ─ SDK 로딩 ─ */
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

/** ─ 토큰: 백엔드에서 짧게 받아 메모리에만 보관 ─ */
let memToken: { value: string; exp: number } | null = null;

async function fetchAccessToken(): Promise<{ access_token: string; expires_in?: number }> {
  const res = await fetch(`${API_BASE}/api/spotify/token`, {
    method: "GET",
    credentials: "include",
    headers: { "Cache-Control": "no-store" },
  });
  if (!res.ok) throw new Error("unauthorized");
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

/** ─ Hook 본체 ─ */
export function useSpotifyPlayer() {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  const [ready, setReady] = useState<boolean>(!!g.__sp_ready);
  const [deviceId, setDeviceId] = useState<string | null>(g.__sp_deviceId ?? null);
  const [state, setState] = useState<WebPlaybackStateLite>({
    position: 0,
    duration: 0,
    paused: true,
    trackUri: null,
  });

  // 중복 호출 방지용
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ensureSDK();
      if (cancelled) return;

      // 이미 전역에 플레이어가 있으면 재사용
      if (g.__sp_player) {
        playerRef.current = g.__sp_player;
        deviceIdRef.current = g.__sp_deviceId ?? null;
        setDeviceId(g.__sp_deviceId ?? null);
        setReady(!!g.__sp_ready);
        return;
      }

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
        g.__sp_ready = true;
        g.__sp_deviceId = ev.device_id;
        deviceIdRef.current = ev.device_id;
        setDeviceId(ev.device_id);
        setReady(true);
      });
      player.addListener("not_ready", () => {
        g.__sp_ready = false;
        setReady(false);
      });

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
      if (!cancelled) {
        playerRef.current = player;
        g.__sp_player = player; // 싱글톤 보관
      }
    })();

    return () => {
      cancelled = true;
      // 싱글톤 유지: disconnect() 하지 않음
      // playerRef.current?.disconnect();
    };
  }, []);

  const activate = useCallback(async () => {
    await playerRef.current?.activateElement?.();
  }, []);

  // 백엔드 호출 (항상 쿠키 동봉)
  const callBackend = useCallback(
    async (endpoint: string, body?: any, method: "GET" | "POST" | "PUT" = "POST") => {
      const init: RequestInit = {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      if (method !== "GET" && body !== undefined) init.body = JSON.stringify(body);
      const r = await fetch(`${API_BASE}${endpoint}`, init);
      if (!r.ok) throw new Error(`${endpoint} failed ${r.status}`);
      return r.json().catch(() => ({}));
    },
    []
  );

  const transferToThisDevice = useCallback(async () => {
    if (!deviceIdRef.current || busyRef.current) return;
    busyRef.current = true;
    try {
      await callBackend("/api/spotify/transfer", {
        device_id: deviceIdRef.current,
        play: true,
      }, "PUT");
    } finally {
      busyRef.current = false;
    }
  }, [callBackend]);

  const playUris = useCallback(
    async (uris: string[]) => {
      if (!ready || !deviceIdRef.current || busyRef.current) return;
      busyRef.current = true;
      try {
        await activate();
        await transferToThisDevice();
        await callBackend(
          "/api/spotify/play",
          { device_id: deviceIdRef.current, uris, position_ms: 0 },
          "PUT"
        );
      } finally {
        busyRef.current = false;
      }
    },
    [ready, activate, transferToThisDevice, callBackend]
  );

  const resume = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await callBackend("/api/spotify/play", { device_id: deviceIdRef.current }, "PUT");
    } finally {
      busyRef.current = false;
    }
  }, [callBackend]);

  const pause = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await callBackend("/api/spotify/pause", {}, "PUT");
    } finally {
      busyRef.current = false;
    }
  }, [callBackend]);

  const next = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await callBackend("/api/spotify/next", {}, "POST");
    } finally {
      busyRef.current = false;
    }
  }, [callBackend]);

  const prev = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await callBackend("/api/spotify/previous", {}, "POST");
    } finally {
      busyRef.current = false;
    }
  }, [callBackend]);

  const seek = useCallback(async (positionMs: number) => {
    await playerRef.current?.seek(Math.max(0, Math.floor(positionMs)));
  }, []);

  return {
    ready,
    deviceId,
    state,
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
