// src/app/editor/EditorClient.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";

export default function EditorClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const photoId = searchParams.get("photoId");
  const historyId = searchParams.get("historyId");
  const musicId = searchParams.get("musicId");

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const candidates = useMemo(() => {
    if (!photoId) return [];
    return [
      `${API_BASE}/api/photos/${photoId}/binary`,
      `${API_BASE}/photos/${photoId}/binary`,
    ];
  }, [photoId]);

  // 업로드된 사진 불러오기 (우선순위 후보 URL 시도)
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

  /* ---------------- 버튼 동작 ---------------- */
  const handleCancel = () => {
    try {
      router.back();
    } catch {
      router.push("/");
    }
  };

  const handleSaveAsIs = () => {
    // 편집 없이 저장 확정 처리 후 홈/히스토리 등으로 이동
    router.push("/");
  };

  const handleGoEdit = () => {
    const q = new URLSearchParams();
    if (photoId) q.set("photoId", String(photoId));
    if (historyId) q.set("historyId", String(historyId));
    if (musicId) q.set("musicId", String(musicId));
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
          <div className="flex justify-center gap-3 mt-6">
            <Button variant="secondary" onClick={handleCancel}>
              돌아가기
            </Button>

            <Button
              variant="outline"
              onClick={handleSaveAsIs}
              className="bg-white !text-slate-900 hover:bg-white/90 border border-white/20"
            >
              저장하기
            </Button>

            <Button
              className="bg-pink-500 hover:bg-pink-600 text-white"
              onClick={handleGoEdit}
            >
              꾸미기
            </Button>
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
