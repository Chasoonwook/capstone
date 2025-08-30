// src/app/recommend/page.tsx
import { Suspense } from "react";
import RecommendClient from "./RecommendClient";

// 정적 프리렌더 방지 (CSR/SSR만)
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RecommendPage() {
  return (
    <Suspense fallback={<div className="p-6 text-white">로딩중…</div>}>
      <RecommendClient />
    </Suspense>
  );
}
