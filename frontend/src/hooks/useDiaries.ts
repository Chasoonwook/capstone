// src/hooks/useDiaries.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { Diary } from "@/types/diary";

/**
 * Diaries 목록 불러오기 훅
 * 백엔드 API: GET /api/diaries?user_id=...&limit=...&offset?=...
 * 응답 형태: 배열([]) 또는 { rows: Diary[], count?, limit?, offset? }
 */
type UseDiariesOptions = {
  limit?: number;
  offset?: number;
  enabled?: boolean; // 활성화 여부 (기본값 true)
};

type UseDiariesResult = {
  diaries: Diary[] | undefined;
  loading: boolean;
  error: string | null;
  meta: {
    count: number;   // 전체 항목 수
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
  const abortRef = useRef<AbortController | null>(null); // 진행 중인 요청 중단 컨트롤러

  const offset = useMemo(() => page * limit, [page, limit]);

  // user_id를 숫자로 보정 (문자열/NaN 방지)
  const numericUserId = useMemo(() => {
    if (userId === null || userId === undefined) return null;
    const n = Number(userId);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, [userId]);

  const fetchDiaries = useCallback(async () => {
    // 비활성화 상태 또는 사용자 ID가 없을 경우 초기 상태로 복귀
    if (!enabled || numericUserId == null) {
      setDiaries([]);
      setLoading(false);
      setError(null);
      return;
    }

    // 이전 요청 취소
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      setLoading(true);
      setError(null);

      // API URL 구성
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

      // 배열 또는 {rows: []} 형태 모두 지원
      const rows: Diary[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
          ? data.rows
          : [];

      setDiaries(rows);
    } catch (err: any) {
      // 요청 취소는 에러로 간주하지 않음
      if (err?.name === "AbortError") return;

      console.error("[useDiaries] Fetch Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load diaries");
      setDiaries([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, numericUserId, limit, offset]);

  useEffect(() => {
    fetchDiaries();
    return () => abortRef.current?.abort(); // 언마운트 시 요청 취소
  }, [fetchDiaries]);

  const reload = useCallback(() => {
    fetchDiaries(); // 데이터 재로딩
  }, [fetchDiaries]);

  const meta = useMemo(() => {
    if (!enabled || numericUserId == null) return null;
    return {
      count: diaries?.length ?? 0, // 현재 로드된 다이어리 개수
      limit,
      offset,
      page,
    };
  }, [enabled, numericUserId, diaries, limit, offset, page]);

  return { diaries, loading, error, meta, setPage, reload }; // 결과 반환
}