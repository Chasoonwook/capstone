type FetchOptions = { timeoutMs?: number }

/** 공통 fetch 래퍼: 타임아웃 + 에러 메시지 보강 + 쿠키 포함 */
export async function apiFetch(input: RequestInfo, init?: RequestInit, opt?: FetchOptions) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), opt?.timeoutMs ?? 15000)
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
      credentials: "include",                // ★ 쿠키 포함
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => "")
      throw new Error(txt || `HTTP ${res.status}`)
    }
    return res
  } finally {
    clearTimeout(t)
  }
}
