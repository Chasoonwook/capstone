// src/lib/spotifyClient.ts
// 브라우저 전용 유틸 (SSR에서 호출 금지)
import { API_BASE } from "@/lib/api";

/** /api/spotify/me 의 응답 형태(권장) */
export type SpotifyMe =
  | { connected: true; product?: string | null; device?: string | null }
  | { connected: false };

const TTL_MS = 60_000;      // 정상 응답 캐시 TTL
const RETRY_TTL_MS = 3_000; // 실패/429 등일 때의 짧은 TTL

let _last = 0;                               // 마지막 캐시 시각
let _cache: SpotifyMe | null = null;         // 캐시 데이터
let _inflight: Promise<SpotifyMe> | null = null; // 중복요청 합치기

/** 캐시 무효화 (연동 직후 강제 재조회 등에 사용) */
export function invalidateSpotifyStatus() {
  _cache = null;
  _last = 0;
  _inflight = null;
}

/**
 * /api/spotify/me 상태 조회
 * - 60초 캐시
 * - 동시 중복요청은 하나로 합침
 * - 401/403 → { connected:false }
 * - 429 → 짧은 TTL(3초)로 { connected:false } 반환
 */
export async function getSpotifyStatus(force = false): Promise<SpotifyMe> {
  if (typeof window === "undefined") {
    // SSR에서는 절대 호출하지 않도록
    return { connected: false };
  }

  const now = Date.now();

  // 캐시 사용
  if (!force && _cache && now - _last < TTL_MS) return _cache;
  if (!force && _inflight) return _inflight;

  const url = `${API_BASE}/api/spotify/me`;

  _inflight = fetch(url, {
    method: "GET",
    credentials: "include", // 쿠키 인증 필수
  })
    .then(async (res): Promise<SpotifyMe> => {
      // 상태별 처리
      if (res.status === 401 || res.status === 403) {
        // 비로그인/토큰없음 → 연결 안 됨 취급 (짧은 TTL로 캐시)
        _cache = { connected: false };
        _last = Date.now(); // 실패 TTL 적용
        // 실패 TTL 동안만 유효하도록 시간차에 따라 TTL 계산
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }

      if (res.status === 429) {
        // 과다요청 → 잠깐 쉬고 false 리턴 (짧은 TTL)
        _cache = { connected: false };
        _last = Date.now();
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }

      if (!res.ok) {
        // 기타 에러도 UX 위해 false로 완화
        _cache = { connected: false };
        _last = Date.now();
        setTimeout(() => (_cache = null), RETRY_TTL_MS);
        return _cache;
      }

      // 정상
      const data = (await res.json()) as SpotifyMe;
      _cache = data ?? { connected: false };
      _last = Date.now();
      return _cache;
    })
    .catch<SpotifyMe>(() => {
      // 네트워크 오류 등도 짧은 TTL로 false
      _cache = { connected: false };
      _last = Date.now();
      setTimeout(() => (_cache = null), RETRY_TTL_MS);
      return _cache;
    })
    .finally(() => {
      // 호출자에게 반환된 뒤에는 inflight 해제
      // (동시 호출은 위에서 합쳐짐)
      _inflight = null;
    });

  return _inflight;
}
