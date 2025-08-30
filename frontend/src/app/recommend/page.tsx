// src/app/recommend/page.tsx
import { Suspense } from "react";
import RecommendClient from "./RecommendClient";

// ✅ 서버 전용 설정은 서버 파일에서만!
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-white">로딩중…</div>}>
      <RecommendClient />
    </Suspense>
  );
}
