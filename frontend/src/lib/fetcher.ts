// src/lib/fetcher.ts
type FetchOptions = { timeoutMs?: number }

/** 공통 fetch 래퍼: 타임아웃, 에러 메시지 보강 포함 */
export async function apiFetch(input: RequestInfo, init?: RequestInit, opt?: FetchOptions) {
  const controller = new AbortController()
  // 타임아웃 설정 (기본 15초)
  const t = setTimeout(() => controller.abort(), opt?.timeoutMs ?? 15000)
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
      credentials: "include", // 쿠키 자동 포함 설정
    })
    if (!res.ok) {
      // 응답 본문을 에러 메시지로 사용
      const txt = await res.text().catch(() => "")
      throw new Error(txt || `HTTP ${res.status}`)
    }
    return res
  } finally {
    // 타임아웃 타이머 해제
    clearTimeout(t)
  }
}