import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Spotify Web Playback SDK에 필요한 사용자 토큰 스코프
 * - 반드시 포함: streaming user-read-email user-read-private
 */
const SCOPES = "streaming user-read-email user-read-private";

type UserTokenResponse = {
  access_token: string;
  expires_in: number; // seconds
};

export function useSpotifyAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 타이머 정리 */
  const clearTimer = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  /** 세션 상태 확인 */
  const fetchSession = useCallback(async () => {
    try {
      const r = await fetch("/api/spotify/session", { cache: "no-store" });
      const j = await r.json();
      setIsLoggedIn(Boolean(j?.loggedIn));
      return Boolean(j?.loggedIn);
    } catch {
      setIsLoggedIn(false);
      return false;
    }
  }, []);

  /** 사용자 토큰 획득 (Authorization Code Flow 기반) */
  const fetchUserToken = useCallback(async () => {
    try {
      const r = await fetch("/api/spotify/user-token", { cache: "no-store" });
      if (!r.ok) {
        // 토큰 없음/만료 등 → null 처리
        setAccessToken(null);
        clearTimer();
        return;
      }
      const j: UserTokenResponse = await r.json();

      // 토큰 저장
      setAccessToken(j?.access_token ?? null);

      // 만료 60초 전에 자동 갱신
      clearTimer();
      const sec = Math.max(30, (j?.expires_in ?? 3600) - 60);
      refreshTimerRef.current = setTimeout(fetchUserToken, sec * 1000);
    } catch {
      setAccessToken(null);
      clearTimer();
    }
  }, []);

  /** 최초 마운트: 세션 → 토큰 순으로 로드 */
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await fetchSession();
      if (!alive) return;
      if (ok) await fetchUserToken();
    })();
    return () => {
      alive = false;
      clearTimer();
    };
  }, [fetchSession, fetchUserToken]);

  /** 창 포커스 시 토큰 재확인 (모바일 백그라운드/복귀 대비) */
  useEffect(() => {
    const onFocus = async () => {
      const ok = await fetchSession();
      if (ok) await fetchUserToken();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchSession, fetchUserToken]);

  /** 로그인: 필요한 스코프를 명시해서 서버 라우트로 이동 */
  const login = useCallback(() => {
    const u = new URL("/api/spotify/login", window.location.origin);
    // 서버 라우트가 scope 파라미터를 받도록 구현되어 있어야 함
    u.searchParams.set("scope", SCOPES);
    window.location.href = u.toString();
  }, []);

  /** 로그아웃 */
  const logout = useCallback(() => {
    fetch("/api/spotify/logout", { method: "POST" }).finally(() => {
      clearTimer();
      window.location.reload();
    });
  }, []);

  return { isLoggedIn, accessToken, login, logout };
}
