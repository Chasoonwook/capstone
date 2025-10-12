// src/hooks/useSpotifyPlayer.ts
"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/api";

type ReadyEvent = { device_id: string };
type ErrorEvent = { message: string };
type WebPlaybackStateLite = { position: number; duration: number; paused: boolean; trackUri: string | null };
type TokenGetter = (cb: (token: string) => void) => void;
type PlayerOptions = { name: string; getOAuthToken: TokenGetter; volume?: number };
type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: "ready", cb: (ev: ReadyEvent) => void): void;
  addListener(event: "not_ready", cb: (ev: ReadyEvent) => void): void;
  addListener(event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", cb: (ev: ErrorEvent) => void): void;
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
type SpotifyWindow = Window & { onSpotifyWebPlaybackSDKReady?: () => void; Spotify?: SpotifyNS };

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

export function useSpotifyPlayer() {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [state, setState] = useState<WebPlaybackStateLite>({
    position: 0, duration: 0, paused: true, trackUri: null,
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
      player.addListener("authentication_error", ({ message }) => console.error("Auth Error:", message));
      player.addListener("account_error", ({ message }) => console.error("Account Error:", message));
      player.addListener("playback_error", ({ message }) => console.error("Playback Error:", message));

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

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const activate = useCallback(async () => {
    try { await playerRef.current?.activateElement?.(); } catch {}
  }, []);

  const callBackend = useCallback(
    async (endpoint: string, body?: any, method: "GET" | "POST" | "PUT" = "POST") => {
      const init: RequestInit = {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      if (method !== "GET" && body !== undefined) init.body = JSON.stringify(body);
      const r = await fetch(`${API_BASE}${endpoint}`, init);
      // 에러는 그대로 throw해서 상태/메시지 보이게
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`${endpoint} ${r.status} ${text || ""}`.trim());
      }
      return r.json().catch(() => ({}));
    },
    []
  );

  const transferToThisDevice = useCallback(async () => {
    if (!deviceIdRef.current) throw new Error("no_device_id");
    await callBackend("/api/spotify/transfer", { device_id: deviceIdRef.current, play: true }, "PUT");
    // 전환 시간 약간 대기
    await sleep(300);
  }, [callBackend]);

  const playUris = useCallback(
    async (uris: string[]) => {
      if (!ready || !deviceIdRef.current) throw new Error("player_not_ready");
      await activate();              // 사용자 제스처 필요 시
      await transferToThisDevice();  // 디바이스 전환
      await callBackend("/api/spotify/play",
        { device_id: deviceIdRef.current, uris, position_ms: 0 }, "PUT");
    },
    [ready, activate, transferToThisDevice, callBackend]
  );

  const resume = useCallback(async () => {
    if (!deviceIdRef.current) throw new Error("no_device_id");
    await callBackend("/api/spotify/play", { device_id: deviceIdRef.current }, "PUT");
  }, [callBackend]);

  const pause = useCallback(async () => {
    await callBackend("/api/spotify/pause", {}, "PUT");
  }, [callBackend]);

  const next = useCallback(async () => {
    await callBackend("/api/spotify/next", {}, "POST");
  }, [callBackend]);

  const prev = useCallback(async () => {
    await callBackend("/api/spotify/previous", {}, "POST");
  }, [callBackend]);

  const seek = useCallback(async (positionMs: number) => {
    await playerRef.current?.seek(Math.max(0, Math.floor(positionMs)));
  }, []);

  return { ready, deviceId, state, activate, transferToThisDevice, playUris, resume, pause, next, prev, seek };
}
