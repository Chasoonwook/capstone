// src/app/recommend/page.tsx
import { Suspense } from "react";
import RecommendClient from "./RecommendClient";

// 정적 프리렌더 방지 (CSR/SSR만)
export const dynamic = "force-dynamic";

export default function RecommendPage(props: any) {
  // 프로젝트별 PageProps 정의와 충돌하지 않도록 느슨하게 처리
  const sp = (props?.searchParams ?? {}) as Record<string, string | string[] | undefined>;

  const photoId =
    typeof sp.photoId === "string"
      ? sp.photoId
      : Array.isArray(sp.photoId)
      ? sp.photoId[0]
      : null;

  const userName =
    typeof sp.user === "string"
      ? sp.user
      : Array.isArray(sp.user)
      ? sp.user[0]
      : null;

  return (
    <Suspense fallback={<div className="p-6 text-white">로딩중…</div>}>
      <RecommendClient photoId={photoId} userName={userName} />
    </Suspense>
  );
}
