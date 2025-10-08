"use client";

import { useEffect, useRef, useState, useCallback, type MutableRefObject } from "react";
import { API_BASE } from "@/lib/api";

// --- 타입 정의 ---
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
type SpotifyWindow = Window & {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: SpotifyNS;
};

// --- SDK 로딩 스크립트 (수정 없음) ---
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

// --- 토큰 관리 로직 ---
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

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
    try {
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
            return newAccessToken;
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function getValidAccessToken(): Promise<string | null> {
    const tokenInfo = getSpotifyTokenFromStorage();
    if (!tokenInfo) return null;

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

async function createAuthHeaders() {
    const token = await getValidAccessToken();
    if (!token) return null;
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

// ===== Hook 본체 =====
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
            if (cancelled) return;

            if (!playerRef.current) {
                const PlayerCtor = (window as SpotifyWindow).Spotify!.Player;
                const player = new PlayerCtor({
                    name: "PhotoMoodMusic Web Player",
                    volume: 0.7,
                    getOAuthToken: async (cb) => {
                        const token = await getValidAccessToken();
                        if (token) cb(token);
                    },
                });

                player.addListener("ready", (ev) => {
                    deviceIdRef.current = ev.device_id;
                    setDeviceId(ev.device_id);
                    setReady(true);
                });
                player.addListener("not_ready", () => setReady(false));
                player.addListener("authentication_error", ({ message }) => {
                    console.error("Auth Error:", message);
                    localStorage.removeItem("spotify_access_token");
                    localStorage.removeItem("spotify_refresh_token");
                    localStorage.removeItem("spotify_token_expires_at");
                });
                player.addListener("account_error", ({ message }) => console.error("Account Error:", message));
                player.addListener("playback_error", ({ message }) => console.error("Playback Error:", message));
                player.addListener("player_state_changed", (s) => {
                    if (!s) return;
                    setState({
                        position: s.position || 0,
                        duration: s.duration || 0,
                        paused: !!s.paused,
                        trackUri: s.track_window?.current_track?.uri ?? null,
                    });
                });
                
                await player.connect();
                playerRef.current = player;
            }
        })();
        return () => { cancelled = true; playerRef.current?.disconnect(); };
    }, []);

    const activate = useCallback(async () => {
        await playerRef.current?.activateElement?.();
    }, []);

    const genericApiCall = useCallback(async (endpoint: string, options: RequestInit) => {
        const headers = await createAuthHeaders();
        if (!headers) throw new Error("Not authenticated");
        return fetch(`${API_BASE}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
    }, []);

    const transferToThisDevice = useCallback(async () => {
        if (!deviceIdRef.current) return;
        await genericApiCall("/api/spotify/transfer", {
            method: "PUT",
            body: JSON.stringify({ device_id: deviceIdRef.current, play: true }),
        });
    }, [genericApiCall]);

    const playUris = useCallback(async (uris: string[]) => {
        if (!ready || !deviceIdRef.current) return;
        await activate();
        await transferToThisDevice();
        await genericApiCall("/api/spotify/play", {
            method: "PUT",
            body: JSON.stringify({ device_id: deviceIdRef.current, uris, position_ms: 0 }),
        });
    }, [ready, activate, transferToThisDevice, genericApiCall]);

    const resume = useCallback(async () => {
        await genericApiCall("/api/spotify/play", {
            method: "PUT",
            body: JSON.stringify({ device_id: deviceIdRef.current }),
        });
    }, [genericApiCall]);

    const pause = useCallback(async () => {
        await genericApiCall("/api/spotify/pause", { method: "PUT", body: '{}' });
    }, [genericApiCall]);

    const next = useCallback(async () => {
        await genericApiCall("/api/spotify/next", { method: "POST", body: '{}' });
    }, [genericApiCall]);

    const prev = useCallback(async () => {
        await genericApiCall("/api/spotify/previous", { method: "POST", body: '{}' });
    }, [genericApiCall]);
    
    const seek = useCallback(async (positionMs: number) => {
        await playerRef.current?.seek(Math.max(0, Math.floor(positionMs)));
    }, []);

    return { ready, deviceId, state, activate, transferToThisDevice, playUris, resume, pause, next, prev, seek };
}