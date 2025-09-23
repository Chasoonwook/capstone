// src/app/editor/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";

export default function EditorPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const photoId = searchParams.get("photoId");
  const historyId = searchParams.get("historyId"); // 필요하면 내부 로직에서만 사용

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // 업로드된 사진 불러오기 (RecommendClient와 동일한 후보 URL 사용)
  useEffect(() => {
    if (!photoId) return;

    const candidates = [
      `${API_BASE}/api/photos/${photoId}/binary`,
      `${API_BASE}/photos/${photoId}/binary`,
    ];

    (async () => {
      for (const u of candidates) {
        try {
          const r = await fetch(u, { method: "GET" });
          if (r.ok) {
            setImgUrl(u);
            return;
          }
        } catch {}
      }
      setImgUrl("/placeholder.svg");
    })();
  }, [photoId]);

  /* ---------------- 버튼 동작 ---------------- */
  const handleCancel = () => {
    // 이전 화면으로
    try {
      router.back();
    } catch {
      router.push("/");
    }
  };

  const handleSaveAsIs = async () => {
    // 편집 없이 그대로 확정하는 경우,
    // - 이미 RecommendClient에서 history 임시 저장을 했으므로
    //   여기서는 완료 화면으로 이동하거나 홈/히스토리로 보낼 수 있음.
    //   필요시 /api/history를 다시 POST(업서트)해 created_at만 갱신해도 됨.
    router.push("/");
  };

  const handleGoEdit = () => {
    const q = new URLSearchParams();
    if (photoId) q.set("photoId", String(photoId));
    if (historyId) q.set("historyId", String(historyId));
    // ✅ RecommendClient 에서 붙여준 musicId를 그대로 전달
    const musicId = searchParams.get("musicId");
    if (musicId) q.set("musicId", String(musicId));

    router.push(`/editor/edit?${q.toString()}`);
    };

  return (
    <div className="min-h-screen w-full bg-black text-white flex flex-col items-center py-10">
      {/* 제목 */}
      <h1 className="text-3xl font-bold mb-1">추억 저장하기</h1>

      {/* 안내 문구 (photoId/historyId 출력 제거) */}
      {!isEditing && (
        <p className="text-slate-300 mb-6">추억을 꾸미시겠습니까?</p>
      )}

      {/* 이미지 프리뷰 */}
      <div className="w-[64rem] max-w-[92vw]">
        <div className="w-full rounded-2xl overflow-hidden bg-white/5 flex items-center justify-center">
          {imgUrl && (
            <Image
              src={imgUrl}
              alt="uploaded photo"
              width={1280}
              height={960}
              className="object-contain max-h-[70vh]"
              priority
            />
          )}
        </div>

        {/* 확인 단계 버튼: 취소 / 그대로 저장하기 / 편집하기 */}
        {!isEditing && (
          <div className="flex justify-center gap-3 mt-6">
            <Button variant="secondary" onClick={handleCancel}>
                돌아가기
            </Button>

            {/* 항상 라벨이 보이도록 텍스트 색을 강제로 지정 */}
            <Button
                variant="outline"
                onClick={handleSaveAsIs}
                className="bg-white !text-slate-900 hover:bg-white/90 border border-white/20"
            >
                저장하기
            </Button>

            <Button className="bg-pink-500 hover:bg-pink-600 text-white" onClick={handleGoEdit}>
                꾸미기
            </Button>
            </div>
        )}
      </div>

      {/* 편집 모드 UI: 여기에 기존 편집 캔버스/툴바를 넣으세요 */}
      {isEditing && (
        <div className="w-[64rem] max-w-[92vw] mt-6">
          {/* ⬇⬇ 기존 편집 UI 컴포넌트를 여기에 렌더하세요 ⬇⬇ */}
          {/* <PhotoEditorCanvas photoId={Number(photoId)} historyId={Number(historyId)} /> */}
          {/* ✔ 편집 완료/저장 버튼은 기존 로직(사진 저장 후 /api/history 업서트) 그대로 유지 */}
        </div>
      )}
    </div>
  );
}
