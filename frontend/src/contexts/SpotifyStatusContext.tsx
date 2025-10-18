"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getSpotifyStatus } from "@/lib/spotifyClient";

export type SpotifyMe =
  | { connected: true; product?: string | null; device?: string | null }
  | { connected: false };

type SpotifyContextShape = {
  status: SpotifyMe;
  refresh: () => Promise<void>;
};

const SpotifyStatusContext = createContext<SpotifyContextShape>({
  status: { connected: false },
  refresh: async () => {},
});

/**
 * SpotifyStatusProvider
 * 앱 전체를 감싸 Spotify 연동 상태를 캐시 + 공유합니다.
 * /api/spotify/me 를 1분 캐싱하며, 포커스 전환 시 재조회합니다.
 */
export function SpotifyStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SpotifyMe>({ connected: false });
  const lastFetchRef = useRef<number>(0);

  const fetchStatus = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 60_000) return; // 1분 캐시

    try {
      const res = await getSpotifyStatus();
      setStatus(res ?? { connected: false });
      lastFetchRef.current = now;
    } catch (err) {
      console.warn("SpotifyStatusContext: failed to fetch", err);
      setStatus({ connected: false });
    }
  };

  // 최초 1회 조회
  useEffect(() => {
    fetchStatus(true);
  }, []);

  // 창이 다시 활성화될 때 1분 단위로 재조회
  useEffect(() => {
    const handleFocus = () => fetchStatus();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const value = useMemo(
    () => ({
      status,
      refresh: () => fetchStatus(true),
    }),
    [status],
  );

  return <SpotifyStatusContext.Provider value={value}>{children}</SpotifyStatusContext.Provider>;
}

/**
 * useSpotifyStatus
 * - Spotify 연동 상태를 어디서든 가져올 수 있습니다.
 * - { status, refresh } 형태로 반환됩니다.
 */
export function useSpotifyStatus() {
  return useContext(SpotifyStatusContext);
}
