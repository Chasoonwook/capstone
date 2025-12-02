// src/lib/spotifyClient.ts
// 브라우저 전용: Spotify 상태 캐싱 및 Web Playback SDK 헬퍼

import { API_BASE } from "@/lib/api";

/* ------------------------------------------------------------------ */
/* 1. /api/spotify/me 상태 캐시 및 중복 요청 통합                      */
/* ------------------------------------------------------------------ */
export type SpotifyMe =
  | { connected: true; product?: string | null; device?: string | null }
  | { connected: false };

const TTL_MS = 60_000; // 캐시 유지 시간 (60초)
const RETRY_TTL_MS = 3_000; // 에러 시 재시도 대기 시간

let _last = 0;
let _cache: SpotifyMe | null = null;
let _inflight: Promise<SpotifyMe> | null = null;

export function invalidateSpotifyStatus() {
  _cache = null;
  _last = 0;
  _inflight = null;
}

export async function getSpotifyStatus(force = false): Promise<SpotifyMe> {
  // SSR 환경 호출 방지
  if (typeof window === "undefined") return { connected: false };

  const now = Date.now();
  // 캐시 유효성 검사 및 진행 중인 요청 반환
  if (!force && _cache && now - _last < TTL_MS) return _cache;
  if (!force && _inflight) return _inflight;

  const url = `${API_BASE}/api/spotify/me`;

  // 신규 요청 시작
  _inflight = fetch(url, { method: "GET", credentials: "include" })
    .then(async (res): Promise<SpotifyMe> => {
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        // 권한/속도 제한 에러 시 캐시 설정 후 재시도 시간 설정
        _cache = { connected: false };
        _last = Date.now();
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }
      if (!res.ok) {
        // 기타 네트워크/HTTP 에러 처리
        _cache = { connected: false };
        _last = Date.now();
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }
      const data = (await res.json()) as SpotifyMe;
      // 성공적인 데이터 캐싱
      _cache = data ?? { connected: false };
      _last = Date.now();
      return _cache;
    })
    .catch<SpotifyMe>(() => {
      // Fetch 자체 에러 처리
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

/* ------------------------------------------------------------------ */
/* 2. Web Playback SDK 로더 및 플레이어 생성                            */
/* ------------------------------------------------------------------ */
type CreateWebPlayerOptions = {
  name?: string;
  volume?: number; // 0~1
};

async function loadSpotifySdkScript(): Promise<void> {
  if (typeof window === "undefined") return;
  const w = window as any;

  // 이미 로드되었거나 로딩 중인 경우 처리
  if (w.Spotify) return;
  if (w.__spotifySdkLoading) return w.__spotifySdkLoading;

  w.__spotifySdkLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;

    // SDK 준비 콜백 함수 정의
    const prev = w.onSpotifyWebPlaybackSDKReady;
    w.onSpotifyWebPlaybackSDKReady = () => {
      try {
        prev && prev();
      } finally {
        resolve();
      }
    };

    script.onerror = () => reject(new Error("Spotify SDK load failed")); // 에러 메시지 영문화
    document.head.appendChild(script);
  });

  return w.__spotifySdkLoading;
}

async function fetchSdkToken(): Promise<string> {
  const r = await fetch(`${API_BASE}/api/spotify/token`, {
    credentials: "include",
  });
  const j = await r.json();
  if (!r.ok || !j?.access_token) {
    throw new Error("No Spotify access token"); // 에러 메시지 영문화
  }
  return j.access_token as string;
}

/** SDK 플레이어 생성 및 deviceId 확보 */
export async function createWebPlayer(opts: CreateWebPlayerOptions = {}) {
  const { name = "MoodTune Web Player", volume = 0.8 } = opts;

  await loadSpotifySdkScript();

  const w = window as any;
  const Spotify = w.Spotify;
  if (!Spotify || !Spotify.Player) {
    throw new Error("Spotify SDK not available"); // 에러 메시지 영문화
  }

  const player = new Spotify.Player({
    name,
    getOAuthToken: async (cb: (token: string) => void) => {
      try {
        const token = await fetchSdkToken();
        cb(token);
      } catch {
        // 토큰 실패 시 재생 불가 처리
      }
    },
    volume,
  });

  // 연결 및 device_id 확보 프로미스
  const deviceId: string = await new Promise((resolve, reject) => {
    player.addListener("ready", ({ device_id }: any) => resolve(device_id));
    player.addListener("not_ready", ({ device_id }: any) => {
      console.warn("Device went offline", device_id); // 로그 메시지 영문화
    });
    player.addListener("initialization_error", (e: any) => reject(e));
    player.addListener("authentication_error", (e: any) => reject(e));
    player.addListener("account_error", (e: any) => reject(e));

    player.connect().then((ok: boolean) => {
      if (!ok) reject(new Error("player.connect() failed")); // 에러 메시지 영문화
    });
  });

  // 초기 볼륨 설정 시도
  try {
    await player.setVolume(volume);
  } catch {}

  return { player, deviceId };
}

/* ------------------------------------------------------------------ */
/* 3. 백엔드 프록시 컨트롤 (편의 함수)                                 */
/* ------------------------------------------------------------------ */

export async function transferToDevice(deviceId: string, play = true) {
  await fetch(`${API_BASE}/api/spotify/transfer`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, play }),
  });
}

export async function playUris(uris: string[], deviceId?: string) {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  await fetch(`${API_BASE}/api/spotify/play${qs}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris }),
  });
}

export async function pausePlayback() {
  await fetch(`${API_BASE}/api/spotify/pause`, {
    method: "PUT",
    credentials: "include",
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