// src/hooks/useSpotifyPlayer.ts
import { useEffect, useRef, useState, useCallback } from "react";

/** ---- 최소 타입 정의 ---- */
type ReadyEvent = { device_id: string };
type ErrorEvent = { message: string };
type WebPlaybackState = unknown;

type TokenGetter = (cb: (token: string) => void) => void;
type PlayerOptions = { name: string; getOAuthToken: TokenGetter; volume?: number };

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
  addListener(event: "player_state_changed", cb: (state: WebPlaybackState) => void): boolean;
  removeListener(event: string): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
};

type SpotifyNS = { Player: new (opts: PlayerOptions) => SpotifyPlayer };
type SpotifyWindow = Window & {
  onSpotifyWebPlaybackSDKReady?: () => void;
  Spotify?: SpotifyNS;
};

async function ensureSDK(): Promise<void> {
  const w = window as unknown as SpotifyWindow;
  if (w.Spotify) return;

  // 이미 추가된 스크립트가 있으면 onload만 기다림
  const existing = document.querySelector<HTMLScriptElement>(
    'script[src="https://sdk.scdn.co/spotify-player.js"]'
  );
  if (!existing) {
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.async = true;
    document.body.appendChild(s);
  }

  await new Promise<void>((resolve) => {
    w.onSpotifyWebPlaybackSDKReady = () => resolve();
  });
}

export function useSpotifyPlayer(userAccessToken: string | null) {
  const tokenRef = useRef<string | null>(userAccessToken);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // 토큰 최신화(리프레시 대응)
  useEffect(() => {
    tokenRef.current = userAccessToken;
  }, [userAccessToken]);

  // SDK 로드 & 플레이어 생성/정리
  useEffect(() => {
    if (!userAccessToken) {
      // 토큰이 사라지면 정리
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
      setDeviceId(null);
      setReady(false);
      return;
    }

    let cancelled = false;

    (async () => {
      await ensureSDK();
      if (cancelled) return;

      const w = window as unknown as SpotifyWindow;
      const spotifyNS = w.Spotify;
      if (!spotifyNS) return;

      const PlayerCtor = spotifyNS.Player;

      // 이미 인스턴스가 있으면 재사용 (getOAuthToken은 항상 tokenRef를 참조)
      if (!playerRef.current) {
        const Ctor: new (opts: PlayerOptions) => SpotifyPlayer = PlayerCtor;
        playerRef.current = new Ctor({
          name: "Photo-mood Web Player",
          getOAuthToken: (cb) => {
            const tk = tokenRef.current;
            if (tk) cb(tk);
          },
          volume: 0.8,
        });

        const p = playerRef.current;
         p.addListener("ready", ({ device_id }) => {
          deviceIdRef.current = device_id;
          setDeviceId(device_id);
          setReady(true);
        });
        p.addListener("not_ready", () => setReady(false));
        p.addListener("initialization_error", ({ message }) =>
          console.error("[Spotify SDK] initialization_error:", message)
        );
        p.addListener("authentication_error", ({ message }) => {
          console.error("[Spotify SDK] authentication_error:", message);
          setReady(false);
        });
        p.addListener("account_error", ({ message }) =>
          console.error("[Spotify SDK] account_error:", message)
        );
        p.addListener("playback_error", ({ message }) =>
          console.error("[Spotify SDK] playback_error:", message)
        );

        try {
          await p.connect();
        } catch {
          // 연결 실패 시 그대로 둠(다음 토큰/포커스에서 재시도)
        }
      } else {
        // 기존 인스턴스가 있으면 ready 상태는 이벤트로 갱신됨
      }
    })();

    return () => {
      cancelled = true;
      // 앱 전역 단일 인스턴스를 원하면 아래 정리를 비활성화 가능
      // playerRef.current?.disconnect();
      // playerRef.current = null;
      // deviceIdRef.current = null;
      // setDeviceId(null);
      // setReady(false);
    };
  }, [userAccessToken]);

  /** 이 디바이스로 재생 전환(Transfer playback) */
  const transferToThisDevice = useCallback(async () => {
    const devId = deviceIdRef.current;
    const token = tokenRef.current;
    if (!devId || !token) return;

    try {
      await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ device_ids: [devId], play: false }),
      });
    } catch (e) {
      console.warn("[Spotify] transfer playback failed:", e);
    }
  }, []);

  /** 재생: URI 배열 */
  const playUris = useCallback(
    async (uris: string[]) => {
      if (!ready) throw new Error("player_not_ready");
      if (!deviceIdRef.current) throw new Error("no_device_id");
      if (!tokenRef.current) throw new Error("no_user_token");

      // 디바이스를 이 플레이어로 전환
      await transferToThisDevice();

      const qs = new URLSearchParams({ device_id: deviceIdRef.current });
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?${qs.toString()}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris }),
      });

      if (!res.ok) {
        const t = await res.text();
        console.error("[Spotify] playUris failed:", res.status, t);
        throw new Error(`play_failed_${res.status}`);
      }
    },
    [ready, transferToThisDevice]
  );

  const resume = useCallback(async () => {
    if (!ready || !tokenRef.current) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    if (!res.ok) console.warn("[Spotify] resume failed:", res.status);
  }, [ready]);

  const pause = useCallback(async () => {
    if (!ready || !tokenRef.current) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/pause", {
      method: "PUT",
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    if (!res.ok) console.warn("[Spotify] pause failed:", res.status);
  }, [ready]);

  const next = useCallback(async () => {
    if (!ready || !tokenRef.current) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    if (!res.ok) console.warn("[Spotify] next failed:", res.status);
  }, [ready]);

  const prev = useCallback(async () => {
    if (!ready || !tokenRef.current) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/previous", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    if (!res.ok) console.warn("[Spotify] previous failed:", res.status);
  }, [ready]);

  return { ready, deviceId, playUris, resume, pause, next, prev };
}
