"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/api";

type SpState = {
  position: number;
  duration: number;
  paused: boolean;
  trackUri?: string | null;
};

type PlayerRef = Spotify.Player | null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function useSpotifyPlayer() {
  const playerRef = useRef<PlayerRef>(null);
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [state, setState] = useState<SpState>({ position: 0, duration: 0, paused: true });

  // SDK 로드
  useEffect(() => {
    let canceled = false;

    const ensureSDK = () =>
      new Promise<void>((resolve) => {
        if ((window as any).Spotify?.Player) return resolve();
        const s = document.createElement("script");
        s.src = "https://sdk.scdn.co/spotify-player.js";
        s.async = true;
        (window as any).onSpotifyWebPlaybackSDKReady = () => resolve();
        document.body.appendChild(s);
      });

    (async () => {
      await ensureSDK();
      if (canceled) return;

      // 토큰은 서버가 세션에서 주도록 구현되어 있다고 가정
      const tokRes = await fetch(`${API_BASE}/api/spotify/token`, { credentials: "include" });
      if (!tokRes.ok) return;
      const { access_token } = await tokRes.json();

      const player = new (window as any).Spotify.Player({
        name: "Web Player",
        getOAuthToken: (cb: (t: string) => void) => cb(access_token),
        volume: 0.7,
      }) as Spotify.Player;

      player.addListener("ready", ({ device_id }) => {
        setDeviceId(device_id);
        setReady(true);
      });

      player.addListener("not_ready", () => {
        setReady(false);
      });

      player.addListener("player_state_changed", (s) => {
        if (!s) return;
        setState({
          position: s.position,
          duration: s.duration,
          paused: s.paused,
          trackUri: s.track_window.current_track?.uri ?? null,
        });
      });

      player.addListener("initialization_error", ({ message }) => console.warn("[sp init]", message));
      player.addListener("authentication_error", ({ message }) => console.warn("[sp auth]", message));
      player.addListener("account_error", ({ message }) => console.warn("[sp account]", message));

      await player.connect();
      playerRef.current = player;
    })();

    return () => {
      canceled = true;
      if (playerRef.current) {
        try { playerRef.current.disconnect(); } catch {}
      }
    };
  }, []);

  /** 서버 -> Spotify /transfer 호출. 404면 약간 기다렸다 재시도. */
  const ensureTransfer = useCallback(
    async (retries = 3) => {
      if (!deviceId) return false;
      for (let i = 0; i < retries; i++) {
        const r = await fetch(`${API_BASE}/api/spotify/transfer`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId }),
        });
        if (r.ok || r.status === 204) return true;

        // Spotify가 {"status":404,"message":"Device not found"} 줄 때
        if (r.status === 404) {
          await sleep(400 + i * 400); // 점점 늘려서 대기 후 재시도
          continue;
        }
        // 기타 오류는 탈출
        break;
      }
      return false;
    },
    [deviceId]
  );

  /** 재생 */
  const playUris = useCallback(
    async (uris: string[]) => {
      if (!ready || !deviceId) {
        alert("Spotify 준비 중입니다. 잠시 후 다시 시도하세요. (Premium 필요)");
        return;
      }

      // 먼저 transfer 보장
      await ensureTransfer();

      const tryPlay = async () =>
        fetch(`${API_BASE}/api/spotify/play`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId, uris }),
        });

      let res = await tryPlay();

      // 404(Device not found)면 한번 더 transfer → 재시도
      if (res.status === 404) {
        await ensureTransfer();
        await sleep(300);
        res = await tryPlay();
      }

      if (!res.ok && res.status !== 204) {
        const txt = await res.text().catch(() => "");
        console.warn("[/api/spotify/play] fail:", res.status, txt);
        alert("Spotify 재생을 시작하지 못했습니다. Spotify 앱을 켜 두었는지 확인해주세요.");
      }
    },
    [deviceId, ready, ensureTransfer]
  );

  const resume = useCallback(async () => {
    // 재생 재시작도 동일하게 보강
    const r = await fetch(`${API_BASE}/api/spotify/play`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (r.status === 404) {
      await ensureTransfer();
      await sleep(300);
      await fetch(`${API_BASE}/api/spotify/play`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId }),
      });
    }
  }, [deviceId, ensureTransfer]);

  const pause = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/pause`, { method: "POST", credentials: "include" });
  }, []);

  const next = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", credentials: "include" });
  }, []);

  const prev = useCallback(async () => {
    await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", credentials: "include" });
  }, []);

  const seek = useCallback(async (ms: number) => {
    await fetch(`${API_BASE}/api/spotify/seek?position_ms=${Math.max(0, Math.floor(ms))}`, {
      method: "POST",
      credentials: "include",
    });
  }, []);

  return {
    ready,
    deviceId,
    state,
    playUris,
    resume,
    pause,
    next,
    prev,
    seek,
  };
}
