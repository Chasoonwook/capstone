"use client";

import { useEffect, useRef, useState, useCallback, type MutableRefObject } from "react";
import { API_BASE } from "@/lib/api";

// --- 타입 정의 (기존과 동일) ---
type ReadyEvent = { device_id: string };
type ErrorEvent = { message: string };
type WebPlaybackStateLite = {
    position: number; // ms
    duration: number; // ms
    paused: boolean;
    trackUri: string | null; // 현재 트랙 URI
};
type TokenGetter = (cb: (token: string) => void) => void;
type PlayerOptions = { name: string; getOAuthToken: TokenGetter; volume?: number };
type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: "ready", cb: (ev: ReadyEvent) => void): void; // ✅ boolean -> void 로 수정
  addListener(event: "not_ready", cb: (ev: ReadyEvent) => void): void; // ✅ boolean -> void 로 수정
  addListener(
    event:
      | "initialization_error"
      | "authentication_error"
      | "account_error"
      | "playback_error",
    cb: (ev: ErrorEvent) => void
  ): void; // ✅ boolean -> void 로 수정
  addListener(event: "player_state_changed", cb: (state: any) => void): void; // ✅ boolean -> void 로 수정
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

// --- SDK 로딩 스크립트 (기존과 동일) ---
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

// ▼▼▼▼▼ [수정됨] 토큰 관리 로직 시작 ▼▼▼▼▼

/** localStorage에서 토큰 정보 읽기 */
function getSpotifyTokenFromStorage(): { accessToken: string; refreshToken: string | null; expiresAt: number } | null {
    try {
        const accessToken = localStorage.getItem("spotify_access_token");
        const refreshToken = localStorage.getItem("spotify_refresh_token");
        const expiresAt = Number(localStorage.getItem("spotify_token_expires_at") || "0");
        if (!accessToken || !expiresAt) return null;
        return { accessToken, refreshToken, expiresAt };
    } catch {
        return null;
    }
}

/** 백엔드를 통해 Access Token 갱신 */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
    try {
        // 백엔드의 /refresh 엔드포인트를 호출합니다. (이전 답변에서 POST로 변경 제안)
        const res = await fetch(`${API_BASE}/api/spotify/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const newAccessToken = data.access_token;
        const newExpiresIn = data.expires_in;

        if (newAccessToken && newExpiresIn) {
            localStorage.setItem("spotify_access_token", newAccessToken);
            const newExpiresAt = Date.now() + newExpiresIn * 1000;
            localStorage.setItem("spotify_token_expires_at", String(newExpiresAt));
            console.log("[Spotify] Token refreshed successfully.");
            return newAccessToken;
        }
        return null;
    } catch (e) {
        console.error("[Spotify] Token refresh failed:", e);
        return null;
    }
}

/** 유효한 Access Token을 가져오는 메인 함수 (필요시 갱신) */
async function getValidAccessToken(): Promise<string | null> {
    const tokenInfo = getSpotifyTokenFromStorage();
    if (!tokenInfo) return null;

    // 만료 5분 전이면 갱신 시도
    if (Date.now() > tokenInfo.expiresAt - 5 * 60 * 1000) {
        if (tokenInfo.refreshToken) {
            return await refreshAccessToken(tokenInfo.refreshToken);
        } else {
            localStorage.removeItem("spotify_access_token");
            localStorage.removeItem("spotify_token_expires_at");
            return null;
        }
    }
    return tokenInfo.accessToken;
}

/** API 요청에 필요한 인증 헤더 생성 */
async function createAuthHeaders() {
    const token = await getValidAccessToken();
    if (!token) return null;
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}
// ▲▲▲▲▲ [수정됨] 토큰 관리 로직 끝 ▲▲▲▲▲


// ===== Hook 본체 =====
export function useSpotifyPlayer() {
    const playerRef = useRef<SpotifyPlayer | null>(null);
    const deviceIdRef = useRef<string | null>(null);
    const [ready, setReady] = useState(false);
    const [deviceId, setDeviceId] = useState<string | null>(null);
    const [state, setState] = useState<WebPlaybackStateLite>({
        position: 0, duration: 0, paused: true, trackUri: null,
    });

    // SDK 로딩 + 플레이어 생성
    useEffect(() => {
        let cancelled = false;
        (async () => {
            await ensureSDK();
            if (cancelled) return;

            const w = window as unknown as SpotifyWindow;
            const PlayerCtor = w.Spotify!.Player;
            
            if (!playerRef.current) {
                const player = new PlayerCtor({
                    name: "PhotoMoodMusic Web Player",
                    volume: 0.7,
                    // ✅ getOAuthToken이 수정된 getValidAccessToken을 직접 호출하도록 변경
                    getOAuthToken: async (cb) => {
                        const token = await getValidAccessToken();
                        if (token) {
                            cb(token);
                        } else {
                            console.error("Failed to get Spotify token for SDK.");
                        }
                    },
                });

                player.addListener("ready", (ev) => {
                    deviceIdRef.current = ev.device_id;
                    setDeviceId(ev.device_id);
                    setReady(true);
                });
                player.addListener("not_ready", () => setReady(false));
                player.addListener("authentication_error", ({ message }) => {
                    console.error("Authentication Error:", message);
                    // 인증 에러 시 토큰 정보 삭제
                    localStorage.removeItem("spotify_access_token");
                    localStorage.removeItem("spotify_refresh_token");
                    localStorage.removeItem("spotify_token_expires_at");
                });
                player.addListener("account_error", ({ message }) => console.error("Account Error:", message));
                player.addListener("playback_error", ({ message }) => console.error("Playback Error:", message));
                player.addListener("player_state_changed", (s: any) => {
                    if (!s) return;
                    setState({
                        position: Number(s.position) || 0,
                        duration: Number(s.duration) || 0,
                        paused: !!s.paused,
                        trackUri: s?.track_window?.current_track?.uri ?? null,
                    });
                });
                
                try { await player.connect(); } catch (e) { console.warn("Player connect failed:", e); }
                playerRef.current = player;
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const activate = useCallback(async () => { /* 수정 없음 */
        const p = playerRef.current;
        if (!p?.activateElement) return;
        try { await p.activateElement(); } catch { }
    }, []);

    // ▼▼▼▼▼ [수정됨] 모든 API 호출에 credentials 대신 Authorization 헤더 사용 ▼▼▼▼▼

    const transferToThisDevice = useCallback(async () => {
        const headers = await createAuthHeaders();
        if (!deviceIdRef.current || !headers) return;
        await fetch(`${API_BASE}/api/spotify/transfer`, {
            method: "PUT", headers,
            body: JSON.stringify({ device_id: deviceIdRef.current, play: true }),
        });
    }, []);

    const playUris = useCallback(async (uris: string[]) => {
        const headers = await createAuthHeaders();
        if (!ready || !deviceIdRef.current || !headers) return;
        await activate();
        await transferToThisDevice();
        await fetch(`${API_BASE}/api/spotify/play`, {
            method: "PUT", headers,
            body: JSON.stringify({ device_id: deviceIdRef.current, uris, position_ms: 0 }),
        });
    }, [ready, activate, transferToThisDevice]);

    const resume = useCallback(async () => {
        const headers = await createAuthHeaders();
        if (!headers) return;
        await fetch(`${API_BASE}/api/spotify/play`, {
            method: "PUT", headers,
            body: JSON.stringify({ device_id: deviceIdRef.current }),
        });
    }, []);

    const pause = useCallback(async () => {
        const headers = await createAuthHeaders();
        if (!headers) return;
        await fetch(`${API_BASE}/api/spotify/pause`, { method: "PUT", headers });
    }, []);

    const next = useCallback(async () => {
        const headers = await createAuthHeaders();
        if (!headers) return;
        await fetch(`${API_BASE}/api/spotify/next`, { method: "POST", headers });
    }, []);

    const prev = useCallback(async () => {
        const headers = await createAuthHeaders();
        if (!headers) return;
        await fetch(`${API_BASE}/api/spotify/previous`, { method: "POST", headers });
    }, []);
    
    const seek = useCallback(async (positionMs: number) => { /* 수정 없음 */
        try {
            const p = playerRef.current;
            if (!p) return;
            await p.seek(Math.max(0, Math.floor(positionMs)));
        } catch { }
    }, []);

    return {
        ready, deviceId, state, activate, transferToThisDevice, playUris, resume, pause, next, prev, seek,
    };
}