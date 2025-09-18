// src/hooks/useSpotifyPlayer.ts
import { useEffect, useRef, useState, useCallback, type MutableRefObject } from "react";

/** ===== 최소 타입 정의 (any 금지) ===== */
type ReadyEvent = { device_id: string };
type ErrorEvent = { message: string };
type WebPlaybackState = unknown;

type TokenGetter = (cb: (token: string) => void) => void;
type PlayerOptions = { name: string; getOAuthToken: TokenGetter; volume?: number };

// Spotify Web Playback SDK Player(필요한 메서드만)
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
  /** 사용자 제스처 직후 오디오 컨텍스트 활성화 (SDK 비공식 시그니처) */
  // eslint-disable-next-line @typescript-eslint/ban-types
  activateElement?: () => void | Promise<void>;
};

type SpotifyNS = { Player: new (opts: PlayerOptions) => SpotifyPlayer };

type SpotifyWindow = Window & {
  onSpotifyWebPlaybackSDKReady?: () => void;
  Spotify?: SpotifyNS;
};

/** SDK 스크립트 보장 로더 */
async function ensureSDK(): Promise<void> {
  const w = window as unknown as SpotifyWindow;

  // 이미 로드됨
  if (w.Spotify?.Player) return;

  // 스크립트가 없으면 추가
  const exist = document.querySelector<HTMLScriptElement>(
    'script[src="https://sdk.scdn.co/spotify-player.js"]'
  );
  if (!exist) {
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.async = true;
    document.head.appendChild(s);
  }

  // onSpotifyWebPlaybackSDKReady 콜백 대기
  await new Promise<void>((resolve) => {
    const ww = window as unknown as SpotifyWindow;

    // 혹시 아주 빠르게 로드됐으면 즉시 종료
    if (ww.Spotify?.Player) {
      resolve();
      return;
    }

    ww.onSpotifyWebPlaybackSDKReady = () => {
      resolve();
    };
  });
}

/** 디바이스 목록 조회(헬퍼) */
async function fetchDevices(token: string) {
  const r = await fetch("https://api.spotify.com/v1/me/player/devices", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`devices_failed_${r.status}`);
  return (await r.json()) as { devices: Array<{ id: string; is_active: boolean }> };
}

/** ===== Hook 본체 ===== */
export function useSpotifyPlayer(userAccessToken: string | null) {
  const tokenRef    = useRef<string | null>(userAccessToken) as MutableRefObject<string | null>;
  const playerRef   = useRef<SpotifyPlayer | null>(null)      as MutableRefObject<SpotifyPlayer | null>;
  const deviceIdRef = useRef<string | null>(null)             as MutableRefObject<string | null>;

  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // 최신 토큰 유지
  useEffect(() => {
    tokenRef.current = userAccessToken;
  }, [userAccessToken]);

  // SDK 로딩 + 플레이어 생성/유지
  useEffect(() => {
    // 토큰이 없다면 정리
    if (!userAccessToken) {
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
      const PlayerCtor = w.Spotify!.Player;

      // 이미 인스턴스 있으면 재사용
      if (!playerRef.current) {
        const player = new PlayerCtor({
          name: "Photo-mood Web Player",
          getOAuthToken: (cb) => {
            const tk = tokenRef.current;
            if (tk) cb(tk);
          },
          volume: 0.8,
        });

        // 이벤트 바인딩
        player.addListener("ready", (ev) => {
          deviceIdRef.current = ev.device_id;
          setDeviceId(ev.device_id);
          setReady(true);
        });
        player.addListener("not_ready", () => {
          setReady(false);
        });
        player.addListener("initialization_error", ({ message }) => {
          console.error("[Spotify SDK] initialization_error:", message);
        });
        player.addListener("authentication_error", ({ message }) => {
          console.error("[Spotify SDK] authentication_error:", message);
          setReady(false);
        });
        player.addListener("account_error", ({ message }) => {
          console.error("[Spotify SDK] account_error:", message);
          // 프리미엄 계정이 아니면 여기로 떨어질 수 있음
        });
        player.addListener("playback_error", ({ message }) => {
          console.error("[Spotify SDK] playback_error:", message);
        });

        // 타입 캐스팅으로 ref에 대입
        playerRef.current = player as unknown as SpotifyPlayer;

        try {
          await player.connect();
        } catch (err) {
          console.warn("[Spotify SDK] connect() failed:", err);
          // 실패 시 다음 기회에 재시도
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userAccessToken]);

  /** 사용자 제스처 직후 오디오 컨텍스트 활성화 (모바일/사파리 대응) */
  const activate = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    const fn = p.activateElement;
    if (typeof fn === "function") {
      try {
        await fn();
      } catch {
        /* noop */
      }
    }
  }, []);

  /** 이 디바이스 활성화 보장(transfer + 활성확인 + 볼륨 설정) */
  const ensureActiveDevice = useCallback(async () => {
    if (!deviceIdRef.current || !tokenRef.current) throw new Error("no_device_id");
    const token = tokenRef.current;

    // 1) transfer
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [deviceIdRef.current], play: false }),
    });

    // 2) 최대 5초 동안 활성화 확인 (0.5s 간격)
    for (let i = 0; i < 10; i++) {
      try {
        const js = await fetchDevices(token);
        const mine = js.devices.find((d) => d.id === deviceIdRef.current);
        if (mine?.is_active) {
          // 3) 볼륨 설정(간혹 0으로 시작)
          await fetch(
            `https://api.spotify.com/v1/me/player/volume?volume_percent=50&device_id=${deviceIdRef.current}`,
            { method: "PUT", headers: { Authorization: `Bearer ${token}` } }
          );
          return;
        }
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("device_not_active");
  }, []);

  /** 특정 트랙(URI들) 재생 */
  const playUris = useCallback(
    async (uris: string[]) => {
      if (!ready) throw new Error("player_not_ready");
      if (!deviceIdRef.current) throw new Error("no_device_id");
      if (!tokenRef.current) throw new Error("no_user_token");

      const token = tokenRef.current;

      // 사용자 제스처 직후 활성화 시도(사파리/모바일)
      try { await activate(); } catch {}

      // 활성 디바이스 보장
      await ensureActiveDevice();

      const qs = new URLSearchParams({ device_id: deviceIdRef.current });
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?${qs.toString()}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris, position_ms: 0 }),
      });

      if (!res.ok) {
        const t = await res.text();
        if (res.status === 403) throw new Error("premium_required_403");
        if (res.status === 404) throw new Error("no_active_device_404");
        throw new Error(`play_failed_${res.status}:${t}`);
      }
    },
    [ready, ensureActiveDevice, activate]
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

  return { ready, deviceId, activate, transferToThisDevice: ensureActiveDevice, playUris, resume, pause, next, prev };
}
