// src/hooks/useHistory.ts
"use client";

import { useEffect, useState } from "react";
import type { HistoryItem } from "@/types/music";
import { API_BASE } from "@/lib/api";
import { apiFetch } from "@/lib/fetcher";

export function useHistory(isLoggedIn: boolean) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!isLoggedIn) {
        setHistory([]);
        return;
      }
      setLoading(true);
      setError(null);

      try {
        // uid 가져오기 및 안전한 정규화(콜론 등 불필요한 기호 제거)
        const raw =
          localStorage.getItem("uid") ??
          localStorage.getItem("user_id") ??
          "";
        const uid = String(raw).split(":")[0].trim(); // 예: "1:1" -> "1"

        if (!uid) {
          setHistory([]);
          return;
        }

        // API_BASE는 이미 /api로 끝남 → /history만 붙임
        const url = new URL(`${API_BASE}/history`);
        url.searchParams.set("user_id", uid);

        const res = await apiFetch(url.toString(), {
          method: "GET",
          credentials: "include", // 로컬(3000↔5000) 쿠키 포함
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("세션이 만료되었습니다.");
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const rows = (await res.json()) as Array<{
          history_id: number | string;
          music_id?: number | string;
          photo_id?: number | string;
          title: string;
          artist?: string;
          genre?: string | null;
          label?: string | null;
          selected_from?: string | null;
          created_at?: string;
        }>;

        const mapped: HistoryItem[] = rows.map((r) => ({
          id: r.history_id,
          musicId: r.music_id,
          photoId: r.photo_id,
          title: r.title,
          artist: r.artist,
          genre: r.genre ?? null,
          label: r.label ?? null,
          selectedFrom: (r.selected_from as any) ?? null,
          playedAt: r.created_at,
          image: null,
        }));

        if (mounted) setHistory(mapped);
      } catch (e: any) {
        if (mounted) {
          setError(e?.message || "히스토리를 불러오지 못했습니다.");
          setHistory([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [isLoggedIn]);

  return { history, loading, error };
}
