import { useEffect, useState } from "react";

export function useSpotifyAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/spotify/session", { cache: "no-store" });
        const j = await r.json();
        if (alive) setIsLoggedIn(Boolean(j?.loggedIn));
      } catch { if (alive) setIsLoggedIn(false); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/spotify/token", { cache: "no-store" });
        if (!alive) return;
        if (r.status === 204 || !r.ok) { setAccessToken(null); return; }
        const j = await r.json();
        setAccessToken(j?.access_token ?? null);
      } catch { if (alive) setAccessToken(null); }
    })();
    return () => { alive = false; };
  }, []);

  const login = () => { window.location.href = "/api/spotify/login"; };
  const logout = () => { fetch("/api/spotify/logout", { method: "POST" }).then(() => location.reload()); };

  return { isLoggedIn, accessToken, login, logout };
}
