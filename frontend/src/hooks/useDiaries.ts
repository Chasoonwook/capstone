// src/hooks/useDiaries.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { Diary } from "@/types/diary";

/**
 * Diaries 목록을 불러오는 훅
 * - 백엔드: GET /api/diaries?user_id=...&limit=...&offset?=...
 * - 응답: 배열([]) 또는 { rows: Diary[], count?, limit?, offset? }
 */
type UseDiariesOptions = {
  limit?: number;
  offset?: number;
  enabled?: boolean; // 기본값 true. 로그인 전에는 false로 둘 수 있음.
};

type UseDiariesResult = {
  diaries: Diary[] | undefined;
  loading: boolean;
  error: string | null;
  meta: {
    count: number;   // 서버가 count를 안 줄 때는 rows.length로 대체
    limit: number;
    offset: number;
    page: number;
  } | null;
  setPage: (page: number) => void;
  reload: () => void;
};

export function useDiaries(
  userId: number | string | null | undefined,
  opts?: UseDiariesOptions
): UseDiariesResult {
  const initialLimit = opts?.limit ?? 12;
  const initialOffset = opts?.offset ?? 0;
  const enabled = opts?.enabled ?? true;

  const [limit] = useState(initialLimit);
  const [page, setPage] = useState(Math.floor(initialOffset / initialLimit) || 0);

  const [diaries, setDiaries] = useState<Diary[] | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const offset = useMemo(() => page * limit, [page, limit]);

  // user_id를 숫자로 보정(문자열/NaN 방지)
  const numericUserId = useMemo(() => {
    if (userId === null || userId === undefined) return null;
    const n = Number(userId);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, [userId]);

  const fetchDiaries = useCallback(async () => {
    if (!enabled || numericUserId == null) {
      setDiaries([]);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      setLoading(true);
      setError(null);

      // 백엔드가 offset을 무시해도 무해하므로 같이 전달
      const url =
        `${API_BASE}/api/diaries` +
        `?user_id=${numericUserId}` +
        `&limit=${limit}` +
        `&offset=${offset}`;

      const resp = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || `Failed to fetch diaries: ${resp.status}`);
      }

      const data = await resp.json();

      // 배열 또는 {rows: []} 모두 지원
      const rows: Diary[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
        ? data.rows
        : [];

      setDiaries(rows);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[useDiaries] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load diaries");
      setDiaries([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, numericUserId, limit, offset]);

  useEffect(() => {
    fetchDiaries();
    return () => abortRef.current?.abort();
  }, [fetchDiaries]);

  const reload = useCallback(() => {
    fetchDiaries();
  }, [fetchDiaries]);

  const meta = useMemo(() => {
    if (!enabled || numericUserId == null) return null;
    return {
      count: diaries?.length ?? 0, // 서버가 count를 주더라도 길이와 큰 차이 없음
      limit,
      offset,
      page,
    };
  }, [enabled, numericUserId, diaries, limit, offset, page]);

  return { diaries, loading, error, meta, setPage, reload };
}