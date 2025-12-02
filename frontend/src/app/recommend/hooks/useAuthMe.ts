// src/app/recommend/hooks/useAuthMe.ts
import { API_BASE } from "@/lib/api";

// 앱 토큰 탐색 키 목록 정의
const APP_TOKEN_KEYS = ["app_token", "auth_token", "token", "access_token", "id_token", "jwt"] as const;

// 브라우저 환경 판별 유틸리티 정의
const isBrowser = typeof window !== "undefined" && typeof localStorage !== "undefined";

// JSON 파싱 안전 처리 유틸리티 정의
function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// 사용자 ID 필드 추출 유틸리티 정의
function pickUserId(obj: any): number | null {
  const idCandidate = obj?.id ?? obj?.user_id ?? obj?.user?.id ?? null;
  const n = typeof idCandidate === "string" ? Number(idCandidate) : idCandidate;
  return Number.isFinite(n) && n >= 1 ? Number(n) : null;
}

// 토큰 문자열 정규화 유틸리티 정의
function normalizeBearer(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/^bearer\s+/i, "").trim();
  return trimmed.length >= 20 ? trimmed : null;
}

// fetch 타임아웃 래퍼 정의
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const id = controller ? setTimeout(() => controller.abort(), timeoutMs) : null as any;
  try {
    const res = await fetch(input, { ...init, signal: controller?.signal });
    return res;
  } finally {
    if (id) clearTimeout(id);
  }
}

// 애플리케이션 보관소에서 베어러 토큰 조회 함수 정의
export function readAppBearerToken(): string | null {
  if (!isBrowser) return null;

  const readFrom = (get: (k: string) => string | null) => {
    for (const key of APP_TOKEN_KEYS) {
      try {
        const raw = get(key);
        if (!raw) continue;

        // 객체 형태 토큰 처리 분기
        const obj = safeJsonParse<any>(raw);
        if (obj && typeof obj === "object") {
          const candidate = obj?.access_token ?? obj?.token ?? obj?.id_token ?? obj?.jwt ?? null;
          const normalized = normalizeBearer(candidate);
          if (normalized) return normalized;
        }

        // 순수 문자열 토큰 처리 분기
        const normalized = normalizeBearer(raw);
        if (normalized) return normalized;
      } catch {
        // 무시
      }
    }
    return null;
  };

  return (
    readFrom(localStorage.getItem.bind(localStorage)) ??
    readFrom(sessionStorage.getItem.bind(sessionStorage)) ??
    null
  );
}

// Authorization 헤더 빌드 함수 정의
export function buildAuthHeaderFromLocalStorage(): Record<string, string> {
  const token = readAppBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// /api/auth/me 또는 /api/users/me 기반 사용자 정보 조회 함수 정의
export async function fetchMe(): Promise<{ id: number } | null> {
  // Authorization 우선 처리
  try {
    const authHeader = buildAuthHeaderFromLocalStorage();
    if (authHeader.Authorization) {
      const r = await fetchWithTimeout(`${API_BASE}/api/auth/me`, {
        method: "GET",
        headers: { Accept: "application/json", ...authHeader },
      });
      if (r.ok) {
        const me = safeJsonParse<any>(await r.text());
        const id = pickUserId(me);
        if (id) return { id };
      }
    }
  } catch {
    // 무시
  }

  // 쿠키 인증 처리
  try {
    const r = await fetchWithTimeout(`${API_BASE}/api/auth/me`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const me = safeJsonParse<any>(await r.text());
      const id = pickUserId(me);
      if (id) return { id };
    }
  } catch {
    // 무시
  }

  // 보조 경로 처리
  try {
    const authHeader = buildAuthHeaderFromLocalStorage();
    const r = await fetchWithTimeout(`${API_BASE}/api/users/me`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json", ...authHeader },
    });
    if (r.ok) {
      const me = safeJsonParse<any>(await r.text());
      const id = pickUserId(me);
      if (id) return { id };
    }
  } catch {
    // 무시
  }

  // 실패 시 null 반환
  return null;
}
