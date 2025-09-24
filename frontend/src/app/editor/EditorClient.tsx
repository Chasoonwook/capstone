// src/app/editor/EditorClient.tsx
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";

// ✅ RecommendClient에서 쓰던 인증 유틸 그대로 사용
import { buildAuthHeaderFromLocalStorage, fetchMe } from "@/app/recommend/hooks/useAuthMe";

type HistoryRow = {
  history_id: number;
  user_id: number;
  photo_id: number;
  music_id: number;
  title?: string | null;
  artist?: string | null;
  genre?: string | null;
  label?: string | null;
  selected_from?: "main" | "sub" | null;
  created_at?: string;
};

export default function EditorClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const photoId = searchParams.get("photoId");
  const historyId = searchParams.get("historyId"); // 편집에서 넘어온 값이면 유지만
  const musicId = searchParams.get("musicId");
  const selectedFromParam = searchParams.get("selected_from"); // "main" | "sub" | "preferred"

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const candidates = useMemo(() => {
    if (!photoId) return [];
    return [
      `${API_BASE}/api/photos/${photoId}/binary`,
      `${API_BASE}/photos/${photoId}/binary`,
    ];
  }, [photoId]);

  // 업로드된 사진 불러오기
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!photoId) {
        setImgUrl(null);
        return;
      }
      for (const u of candidates) {
        try {
          const r = await fetch(u, { method: "GET" });
          if (!alive) return;
          if (r.ok) {
            setImgUrl(u);
            return;
          }
        } catch {
          // try next
        }
      }
      setImgUrl("/placeholder.svg");
    })();
    return () => {
      alive = false;
    };
  }, [photoId, candidates]);

  /* ---------------- 저장 로직 (RecommendClient 방식) ---------------- */
  const saveHistory = useCallback(async (): Promise<number | null> => {
    if (!photoId) {
      setErrorMsg("photoId가 없습니다.");
      return null;
    }
    if (!musicId) {
      setErrorMsg("musicId가 없습니다.");
      return null;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      // 1) 로그인 사용자 확인 (쿠키 세션 우선)
      const me = await fetchMe();
      if (!me?.id) {
        // 2) 토큰 헤더로 재시도 준비
        const authHeader = buildAuthHeaderFromLocalStorage();
        if (!authHeader.Authorization) {
          setErrorMsg("로그인이 필요합니다.");
          return null;
        }
        // 토큰을 쓸 거라면 아래 요청에서 헤더로 붙여줄 것이므로 통과
      }

      const selected_from =
        selectedFromParam === "preferred"
          ? null // recommend와 동일 규칙: preferred는 null로 저장
          : selectedFromParam === "sub"
          ? "sub"
          : "main";

      const payload = {
        user_id: me?.id ?? undefined, // 세션이 받지 못하면 아래 재시도에서 토큰으로 인증
        photo_id: Number(photoId),
        music_id: Number(musicId),
        selected_from,
      };

      // 첫 시도: 쿠키 세션 기반
      let res = await fetch(`${API_BASE}/api/history`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // 401 등 실패 시: 로컬 토큰 헤더로 재시도 (RecommendClient와 동일)
      if (!res.ok) {
        const authHeader = buildAuthHeaderFromLocalStorage();
        if (!authHeader.Authorization) {
          const errText = await res.text().catch(() => "");
          throw new Error(errText || `히스토리 저장 실패 (HTTP ${res.status})`);
        }
        // 토큰 헤더 추가 재시도
        res = await fetch(`${API_BASE}/api/history`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            // 서버가 body에 user_id를 요구하므로 me가 없으면 토큰 페이로드에서 읽는 구현이어야 함
            ...payload,
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(errText || `히스토리 저장 실패 (HTTP ${res.status})`);
        }
      }

      const data: HistoryRow = await res.json();
      if (!data?.history_id) {
        throw new Error("서버 응답에 history_id가 없습니다.");
      }
      return data.history_id;
    } catch (e: any) {
      setErrorMsg(e?.message || "네트워크 오류가 발생했습니다.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [photoId, musicId, selectedFromParam]);

  /* ---------------- 버튼 동작 ---------------- */
  const handleCancel = () => {
    try {
      router.back();
    } catch {
      router.push("/");
    }
  };

  const handleSaveAsIs = async () => {
    const newId = await saveHistory();
    if (newId) {
      // 저장 성공 → 히스토리 페이지로 이동 (요구사항)
      router.push("/");
    }
  };

  const handleGoEdit = () => {
    const q = new URLSearchParams();
    if (photoId) q.set("photoId", String(photoId));
    if (historyId) q.set("historyId", String(historyId));
    if (musicId) q.set("musicId", String(musicId));
    if (selectedFromParam) q.set("selected_from", selectedFromParam);
    router.push(`/editor/edit?${q.toString()}`);
  };

  return (
    <div className="min-h-screen w-full bg-black text-white flex flex-col items-center py-10">
      <h1 className="text-3xl font-bold mb-1">추억 저장하기</h1>

      {!isEditing && (
        <p className="text-slate-300 mb-6">추억을 꾸미시겠습니까?</p>
      )}

      <div className="w-[64rem] max-w-[92vw]">
        <div className="w-full rounded-2xl overflow-hidden bg-white/5 flex items-center justify-center">
          {imgUrl ? (
            <Image
              src={imgUrl}
              alt="uploaded photo"
              width={1280}
              height={960}
              className="object-contain max-h-[70vh]"
              priority
            />
          ) : (
            <div className="p-12 text-slate-400">이미지를 불러오는 중…</div>
          )}
        </div>

        {!isEditing && (
          <div className="flex flex-col items-center mt-6">
            {errorMsg && (
              <div className="mb-3 text-sm text-red-400">{errorMsg}</div>
            )}
            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={handleCancel} disabled={saving}>
                돌아가기
              </Button>

              <Button
                variant="outline"
                onClick={handleSaveAsIs}
                disabled={saving}
                className="bg-white !text-slate-900 hover:bg-white/90 border border-white/20"
              >
                {saving ? "저장 중…" : "저장하기"}
              </Button>

              <Button
                className="bg-pink-500 hover:bg-pink-600 text-white"
                onClick={handleGoEdit}
                disabled={saving}
              >
                꾸미기
              </Button>
            </div>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="w-[64rem] max-w-[92vw] mt-6">
          {/* <PhotoEditorCanvas photoId={Number(photoId)} historyId={Number(historyId)} /> */}
        </div>
      )}
    </div>
  );
}
