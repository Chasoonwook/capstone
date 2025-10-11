// src/lib/spotifyClient.ts
// 브라우저에서만 사용하세요. (SSR에서 호출 금지)
import { API_BASE } from "@/lib/api"; // ← 백엔드 베이스 URL (https://capstone-app-back.onrender.com)

let _spLast = 0;
let _spCache: any = null;
let _spInflight: Promise<any> | null = null;

/** 캐시 무효화 (연동 후 강제 재조회용) */
export function invalidateSpotifyStatus() {
  _spCache = null;
  _spLast = 0;
  _spInflight = null;
}

/** /api/spotify/me 상태 조회 — 60초 캐시 + 중복요청 합치기 */
export async function getSpotifyStatus() {
  if (typeof window === "undefined") return { connected: false };

  const now = Date.now();
  if (_spCache && now - _spLast < 60_000) return _spCache;
  if (_spInflight) return _spInflight;

  // ★ 반드시 백엔드 도메인으로 호출 + credentials 포함
  const url = `${API_BASE}/api/spotify/me`;

  _spInflight = fetch(url, { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) throw new Error("status " + r.status);
      const j = await r.json();
      _spCache = j;
      _spLast = Date.now();
      return j;
    })
    .finally(() => {
      _spInflight = null;
    });

  return _spInflight;
}
