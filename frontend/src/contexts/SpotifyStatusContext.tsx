"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import { getSpotifyStatus } from "@/lib/spotifyClient";

export type SpotifyMe =
  | { connected: true; product?: string | null; device?: string | null }
  | { connected: false };

type SpotifyContextShape = {
  status: SpotifyMe;
  refresh: (force?: boolean) => Promise<void>;
};

const Ctx = createContext<SpotifyContextShape>({
  status: { connected: false },
  refresh: async () => {},
});

/**
 * Lazy Provider: 자동으로 /api/spotify/me를 호출하지 않습니다.
 * 필요한 컴포넌트(예: UserHeader)에서 `refresh()`를 호출하세요.
 */
export function SpotifyStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SpotifyMe>({ connected: false });
  const lastRef = useRef(0); // 하드 쿨다운(30초)

  const refresh = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastRef.current < 30_000) return; // 30초 쿨다운

    try {
      const s = await getSpotifyStatus(force);
      setStatus(s ?? { connected: false });
      lastRef.current = Date.now();
    } catch {
      setStatus({ connected: false });
      lastRef.current = Date.now();
    }
  };

  const value = useMemo(() => ({ status, refresh }), [status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSpotifyStatus = () => useContext(Ctx);
