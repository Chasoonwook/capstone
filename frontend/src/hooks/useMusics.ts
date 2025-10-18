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
 * 앱 내부 DB의 음악 목록을 읽어오는 훅
 * - GET {API_BASE}/api/musics
 * - page.tsx는 이 훅의 반환값을 사용해 검색/필터링합니다.
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
        const r = await fetch(`${API_BASE}/musics`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        // 응답 형태가 [{...}] 또는 { musics: [...] } 둘 다 안전 처리
        const list: unknown =
          Array.isArray(data) ? data : (data && data.musics) || [];
        if (alive) setMusics(Array.isArray(list) ? (list as MusicItem[]) : []);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "로드 실패");
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
