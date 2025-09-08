// src/hooks/useSpotifyPlayer.ts
import { useEffect, useRef, useState, useCallback } from "react";

/** ---- 최소 타입 정의 (no any) ---- */
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

/** 글로벌 보강 대신 로컬 타입으로 window를 캐스팅 */
type SpotifyWindow = Window & {
  onSpotifyWebPlaybackSDKReady?: () => void;
  Spotify?: { Player: new (opts: PlayerOptions) => SpotifyPlayer };
};

export function useSpotifyPlayer(accessToken: string | null) {
  const deviceIdRef = useRef<string | null>(null);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!accessToken) return;

    const w = window as unknown as SpotifyWindow;

    // SDK 스크립트가 없으면 1회만 추가
    if (!w.Spotify && !document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
      const s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.async = true;
      document.body.appendChild(s);
    }

    (w as SpotifyWindow).onSpotifyWebPlaybackSDKReady = () => {
      const w2 = window as unknown as SpotifyWindow;

      // 1) 생성자 타입을 명시적으로 확정
      const PlayerCtor = w2.Spotify!.Player as new (opts: PlayerOptions) => SpotifyPlayer;

      // 2) 인스턴스도 명시 타입으로
      const player: SpotifyPlayer = new PlayerCtor({
        name: "Web Playback",
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.8,
      });

      playerRef.current = player;      // ← 이제 오류 안 남
      player.addListener("ready", (e: ReadyEvent) => {
        deviceIdRef.current = e.device_id;
        setReady(true);
      });
      player.addListener("not_ready", () => setReady(false));
      player.addListener("authentication_error", () => setReady(false));
      player.connect().catch(() => setReady(false));
    };


    return () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
    };
  }, [accessToken]);

  /** ---- Web API 호출 ---- */
  const playUris = useCallback(
    async (uris: string[]) => {
      if (!ready || !accessToken || !deviceIdRef.current) return;
      // device_id는 쿼리스트링으로 넘기는 것이 표준
      await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(
          deviceIdRef.current
        )}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris }),
        }
      );
    },
    [ready, accessToken]
  );

  const resume = useCallback(async () => {
    if (!ready || !accessToken) return;
    await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }, [ready, accessToken]);

  const pause = useCallback(async () => {
    if (!ready || !accessToken) return;
    await fetch("https://api.spotify.com/v1/me/player/pause", {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }, [ready, accessToken]);

  const next = useCallback(async () => {
    if (!ready || !accessToken) return;
    await fetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }, [ready, accessToken]);

  const prev = useCallback(async () => {
    if (!ready || !accessToken) return;
    await fetch("https://api.spotify.com/v1/me/player/previous", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }, [ready, accessToken]);

  return { ready, playUris, resume, pause, next, prev };
}
