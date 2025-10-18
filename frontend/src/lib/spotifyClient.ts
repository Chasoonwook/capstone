// src/lib/spotifyClient.ts
// 브라우저 전용 유틸 (SSR에서 호출 금지)
import { API_BASE } from "@/lib/api";

/** /api/spotify/me 의 응답 형태(권장) */
export type SpotifyMe =
  | { connected: true; product?: string | null; device?: string | null }
  | { connected: false };

const TTL_MS = 60_000;      // 정상 응답 캐시 TTL
const RETRY_TTL_MS = 3_000; // 실패/429 등일 때의 짧은 TTL

let _last = 0;                               // 마지막 캐시 시각
let _cache: SpotifyMe | null = null;         // 캐시 데이터
let _inflight: Promise<SpotifyMe> | null = null; // 중복요청 합치기

/** 캐시 무효화 (연동 직후 강제 재조회 등에 사용) */
export function invalidateSpotifyStatus() {
  _cache = null;
  _last = 0;
  _inflight = null;
}

/**
 * /api/spotify/me 상태 조회
 * - 60초 캐시
 * - 동시 중복요청은 하나로 합침
 * - 401/403 → { connected:false }
 * - 429 → 짧은 TTL(3초)로 { connected:false } 반환
 */
export async function getSpotifyStatus(force = false): Promise<SpotifyMe> {
  if (typeof window === "undefined") {
    // SSR에서는 절대 호출하지 않도록
    return { connected: false };
  }

  const now = Date.now();

  // 캐시 사용
  if (!force && _cache && now - _last < TTL_MS) return _cache;
  if (!force && _inflight) return _inflight;

  const url = `${API_BASE}/api/spotify/me`;

  _inflight = fetch(url, {
    method: "GET",
    credentials: "include", // 쿠키 인증 필수
  })
    .then(async (res): Promise<SpotifyMe> => {
      // 상태별 처리
      if (res.status === 401 || res.status === 403) {
        // 비로그인/토큰없음 → 연결 안 됨 취급 (짧은 TTL로 캐시)
        _cache = { connected: false };
        _last = Date.now(); // 실패 TTL 적용
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }

      if (res.status === 429) {
        // 과다요청 → 잠깐 쉬고 false 리턴 (짧은 TTL)
        _cache = { connected: false };
        _last = Date.now();
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }

      if (!res.ok) {
        // 기타 에러도 UX 위해 false로 완화
        _cache = { connected: false };
        _last = Date.now();
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }

      // 정상
      const data = (await res.json()) as SpotifyMe;
      _cache = data ?? { connected: false };
      _last = Date.now();
      return _cache;
    })
    .catch<SpotifyMe>(() => {
      // 네트워크 오류 등도 짧은 TTL로 false
      _cache = { connected: false };
      _last = Date.now();
      setTimeout(() => (_cache = null), RETRY_TTL_MS);
      return _cache;
    })
    .finally(() => {
      _inflight = null;
    });

  return _inflight;
}

/* =======================================================================
   ▼▼▼ 여기부터 추가: Web Playback SDK 로더 + 플레이어 생성 + 간단 API ▼▼▼
   ======================================================================= */

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: any;
  }
}

/** SDK 스크립트 로드 Promise (중복 로드 방지) */
let _sdkPromise: Promise<typeof window.Spotify> | null = null;

/** 브라우저에서 Spotify Web Playback SDK를 로드하고 window.Spotify를 resolve */
export function loadSpotifySDK(): Promise<typeof window.Spotify> {
  if (_sdkPromise) return _sdkPromise;

  _sdkPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("SSR: Spotify SDK cannot load on server"));
      return;
    }

    if (window.Spotify) {
      resolve(window.Spotify);
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) resolve(window.Spotify);
      else reject(new Error("Spotify SDK ready but not found"));
    };

    const ID = "spotify-web-playback-sdk";
    if (!document.getElementById(ID)) {
      const s = document.createElement("script");
      s.id = ID;
      s.async = true;
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.onerror = () => reject(new Error("Spotify SDK script load failed"));
      document.head.appendChild(s);
    }
  });

  return _sdkPromise;
}

/** 백엔드 프록시에서 SDK용 액세스 토큰을 받아오는 헬퍼 */
export async function fetchSdkAccessToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/spotify/token`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`token failed: ${res.status}`);
  }
  const j = await res.json();
  if (!j?.access_token) throw new Error("No access_token");
  return j.access_token as string;
}

/**
 * Web Playback SDK Player 생성
 * - 성공 시 { player, deviceId } 반환
 * - 실패 시 throw
 */
export async function createWebPlayer(params?: {
  name?: string;
  volume?: number; // 0 ~ 1
  /** 필요하면 커스텀 토큰 획득 로직 주입 */
  getOAuthToken?: () => Promise<string>;
}): Promise<{ player: any; deviceId: string }> {
  const { name = "MoodTune Web Player", volume = 0.8, getOAuthToken } = params || {};
  const Spotify = await loadSpotifySDK();

  const player = new Spotify.Player({
    name,
    volume,
    getOAuthToken: async (cb: (token: string) => void) => {
      try {
        const token = getOAuthToken ? await getOAuthToken() : await fetchSdkAccessToken();
        cb(token);
      } catch (e) {
        console.error("[SpotifySDK] getOAuthToken failed:", e);
        cb("");
      }
    },
  });

  player.addListener("initialization_error", ({ message }: any) =>
    console.error("SDK init error:", message),
  );
  player.addListener("authentication_error", ({ message }: any) =>
    console.error("SDK auth error:", message),
  );
  player.addListener("account_error", ({ message }: any) =>
    console.error("SDK account error:", message),
  );
  player.addListener("playback_error", ({ message }: any) =>
    console.error("SDK playback error:", message),
  );

  // ready 이벤트에서 device_id 확보
  const deviceId: string = await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("SDK ready timeout")), 12_000);
    player.addListener("ready", ({ device_id }: any) => {
      clearTimeout(timeout);
      resolve(device_id);
    });
  });

  const ok = await player.connect();
  if (!ok) throw new Error("player.connect() failed");
  return { player, deviceId };
}

/* -----------------------------------------------------------------------
   간단 제어 헬퍼(백엔드 프록시 경유) — 필요한 곳에서 import해서 사용하세요.
   ----------------------------------------------------------------------- */

/** 이 기기로 재생 전환 (필요 시 play=true 로 곡 시작) */
export async function transferToDevice(deviceId: string, play = true) {
  await fetch(`${API_BASE}/api/spotify/transfer`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, play }),
  });
}

/** 특정 트랙 URI(들) 재생 (deviceId 생략 시 Spotify가 기본 기기로 시도) */
export async function playUris(uris: string[], deviceId?: string, position_ms?: number) {
  const url = new URL(`${API_BASE}/api/spotify/play`);
  const body: any = { uris };
  if (typeof position_ms === "number") body.position_ms = position_ms;
  if (deviceId) url.searchParams.set("device_id", deviceId);

  await fetch(url.toString(), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function pausePlayback() {
  await fetch(`${API_BASE}/api/spotify/pause`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
}

export async function nextTrack() {
  await fetch(`${API_BASE}/api/spotify/next`, {
    method: "POST",
    credentials: "include",
  });
}

export async function prevTrack() {
  await fetch(`${API_BASE}/api/spotify/previous`, {
    method: "POST",
    credentials: "include",
  });
}
