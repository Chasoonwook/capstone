"use client";

import { useEffect, useRef, useState, useCallback, type MutableRefObject } from "react";
import { API_BASE } from "@/lib/api";

/** ===== 최소 타입 정의 ===== */
type ReadyEvent = { device_id: string };
type ErrorEvent = { message: string };

/** Web Playback SDK state(우리가 쓰는 필드만) */
type WebPlaybackStateLite = {
  position: number;        // ms
  duration: number;        // ms
  paused: boolean;
  trackUri: string | null; // 현재 트랙 URI
};

type TokenGetter = (cb: (token: string) => void) => void;
type PlayerOptions = { name: string; getOAuthToken: TokenGetter; volume?: number };

// Spotify Web Playback SDK Player (필요 메서드만)
type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: "ready", cb: (ev: ReadyEvent) => void): boolean;
  addListener(event: "not_ready", cb: (ev: ReadyEvent) => void): boolean;
  addListener(
    event:
      | "initialization_error"
      | "authentication_error"
      | "account_error"
      | "playback_error",
    cb: (ev: ErrorEvent) => void
  ): boolean;
  addListener(event: "player_state_changed", cb: (state: any) => void): boolean;
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

/** SDK 스크립트 로더 */
async function ensureSDK(): Promise<void> {
  const w = window as unknown as SpotifyWindow;
  if (w.Spotify?.Player) return;

  const exist = document.querySelector<HTMLScriptElement>('script[src="https://sdk.scdn.co/spotify-player.js"]');
  if (!exist) {
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

/** 백엔드에서 access token 얻기 (쿠키 기반) */
async function fetchAccessToken(): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}/api/spotify/token`, { credentials: "include" });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.access_token ?? null;
  } catch {
    return null;
  }
}

/** ===== Hook 본체 ===== */
export function useSpotifyPlayer() {
  const tokenRef    = useRef<string | null>(null)         as MutableRefObject<string | null>;
  const playerRef   = useRef<SpotifyPlayer | null>(null)  as MutableRefObject<SpotifyPlayer | null>;
  const deviceIdRef = useRef<string | null>(null)         as MutableRefObject<string | null>;

  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // 재생 상태(진행도/길이/일시정지)
  const [state, setState] = useState<WebPlaybackStateLite>({
    position: 0,
    duration: 0,
    paused: true,
    trackUri: null,
  });

  // SDK 로딩 + 플레이어 생성/유지
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ensureSDK();
      if (cancelled) return;

      const w = window as unknown as SpotifyWindow;
      const PlayerCtor = w.Spotify!.Player;

      // 최초 토큰(없어도 플레이어 생성은 가능)
      tokenRef.current = await fetchAccessToken();
      if (!tokenRef.current) {
        console.warn("[Spotify] no access token yet (user not linked?)");
      }

      if (!playerRef.current) {
        const player = new PlayerCtor({
          name: "PhotoMoodMusic Web Player",
          volume: 0.7,
          getOAuthToken: async (cb) => {
            const t = await fetchAccessToken();
            if (t) {
              tokenRef.current = t;
              cb(t);
            }
          },
        });

        player.addListener("ready", (ev) => {
          deviceIdRef.current = ev.device_id;
          setDeviceId(ev.device_id);
          setReady(true);
          console.log("[Spotify SDK] ready, device:", ev.device_id);
        });
        player.addListener("not_ready", () => setReady(false));
        player.addListener("initialization_error", ({ message }) => console.error("init_error:", message));
        player.addListener("authentication_error", ({ message }) => console.error("auth_error:", message));
        player.addListener("account_error", ({ message }) => console.error("account_error:", message));
        player.addListener("playback_error", ({ message }) => console.error("playback_error:", message));

        // ✅ 진행도/길이/일시정지 등 상태 반영
        player.addListener("player_state_changed", (s: any) => {
          if (!s) return;
          setState({
            position: Number(s.position) || 0,
            duration: Number(s.duration) || 0,
            paused: !!s.paused,
            trackUri: s?.track_window?.current_track?.uri ?? null,
          });
        });

        try { await player.connect(); } catch (e) { console.warn("player.connect failed:", e); }
        playerRef.current = player as unknown as SpotifyPlayer;
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /** 사용자 제스처 직후 오디오 컨텍스트 활성화 (모바일/사파리) */
  const activate = useCallback(async () => {
    const p = playerRef.current;
    if (!p?.activateElement) return;
    try { await p.activateElement(); } catch {}
  }, []);

  /** 이 디바이스를 활성 디바이스로 전환 (백엔드 프록시 사용) */
  const ensureActiveDevice = useCallback(async () => {
    if (!deviceIdRef.current) throw new Error("no_device_id");

    await fetch(`${API_BASE}/api/spotify/transfer`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceIdRef.current, play: true }),
    });

    // 짧게 폴링하여 활성화 확인
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch(`${API_BASE}/api/spotify/devices`, { credentials: "include" });
        const j = await r.json();
        const mine = (j?.devices || []).find((d: any) => d.id === deviceIdRef.current);
        if (mine?.is_active) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
  }, []);

  /** 특정 트랙(URI들) 전체 재생 */
  const playUris = useCallback(async (uris: string[]) => {
    if (!ready) throw new Error("player_not_ready");
    if (!deviceIdRef.current) throw new Error("no_device_id");

    try { await activate(); } catch {}
    await ensureActiveDevice();

    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceIdRef.current, uris, position_ms: 0 }),
    });
  }, [ready, ensureActiveDevice, activate]);

  const resume = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/play`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceIdRef.current }),
    });
  }, []);

  const pause = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/pause`, { method: "PUT", credentials: "include" });
  }, []);

  const next = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" });
  }, []);

  const prev = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" });
  }, []);

  /** 시크(밀리초) — SDK 직접 호출 */
  const seek = useCallback(async (positionMs: number) => {
    const p = playerRef.current;
    if (!p) return;
    try { await p.seek(Math.max(0, Math.floor(positionMs))); } catch {}
  }, []);

  return {
    ready,
    deviceId,
    state,                         // { position, duration, paused, trackUri }
    activate,
    transferToThisDevice: ensureActiveDevice,
    playUris,
    resume,
    pause,
    next,
    prev,
    seek,
  };
}
