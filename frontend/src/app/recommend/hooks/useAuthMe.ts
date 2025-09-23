// src/app/recommend/hooks/useAuthMe.ts
import { API_BASE } from "@/lib/api";

const APP_TOKEN_KEYS = ["app_token", "auth_token", "token", "access_token", "id_token", "jwt"];

export function readAppBearerToken(): string | null {
  const readFrom = (get: (k: string) => string | null) => {
    for (const key of APP_TOKEN_KEYS) {
      try {
        const raw = get(key);
        if (!raw) continue;
        try {
          const obj = JSON.parse(raw);
          const candidate = obj?.access_token ?? obj?.token ?? obj?.id_token ?? obj?.jwt ?? null;
          if (candidate && String(candidate).length > 20) return String(candidate);
        } catch {
          if (raw.length > 20) return raw;
        }
      } catch {}
    }
    return null;
  };

  return (
    readFrom(localStorage.getItem.bind(localStorage)) ??
    readFrom(sessionStorage.getItem.bind(sessionStorage)) ??
    null
  );
}

export function buildAuthHeaderFromLocalStorage(): Record<string, string> {
  const raw = readAppBearerToken();
  if (!raw) return {};
  const normalized = raw.replace(/^bearer\s+/i, "").trim();
  if (!normalized || normalized.length < 20) return {};
  return { Authorization: `Bearer ${normalized}` };
}

export async function fetchMe(): Promise<{ id: number } | null> {
  // Authorization 우선
  try {
    const authHeader = buildAuthHeaderFromLocalStorage();
    if (authHeader.Authorization) {
      const r = await fetch(`${API_BASE}/api/auth/me`, {
        method: "GET",
        headers: { Accept: "application/json", ...authHeader },
      });
      if (r.ok) {
        const me = await r.json().catch(() => null);
        const id = me?.id ?? me?.user_id ?? me?.user?.id ?? null;
        return id ? { id: Number(id) } : null;
      }
    }
  } catch {}

  // 쿠키
  try {
    const r = await fetch(`${API_BASE}/api/auth/me`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const me = await r.json().catch(() => null);
      const id = me?.id ?? me?.user_id ?? me?.user?.id ?? null;
      return id ? { id: Number(id) } : null;
    }
  } catch {}

  // 보조 경로
  try {
    const authHeader = buildAuthHeaderFromLocalStorage();
    const r = await fetch(`${API_BASE}/api/users/me`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json", ...authHeader },
    });
    if (r.ok) {
      const me = await r.json().catch(() => null);
      const id = me?.id ?? me?.user_id ?? me?.user?.id ?? null;
      return id ? { id: Number(id) } : null;
    }
  } catch {}

  return null;
}
