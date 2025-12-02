// Frontend/src/hooks/useMusics.ts
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { MusicItem } from "@/types/music";

export type UseMusicsResult = {
  musics: MusicItem[];
  loading: boolean;
  error: string | null;
};

/**
 * 앱 내부 DB 음악 목록 조회 훅
 */
export function useMusics(): UseMusicsResult {
  const [musics, setMusics] = useState<MusicItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function fetchMusics() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API_BASE}/api/musics`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        // 다양한 응답 형태에 대한 예외 처리
        const list: unknown =
          Array.isArray(data) ? data : (data && data.musics) || [];
        if (alive) setMusics(Array.isArray(list) ? (list as MusicItem[]) : []);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    }

    fetchMusics();
    return () => {
      alive = false;
    };
  }, []);

  return { musics, loading, error };
}

export default useMusics;