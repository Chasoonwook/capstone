// src/app/editor/edit/page.tsx
import { Suspense } from "react";
import EditClient from "./EditClient";

// 정적 프리렌더를 피하고 동적 렌더 강제 (CSR 훅 사용 페이지에 안전)
export const dynamic = "force-dynamic";

export default function EditWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <EditClient />
    </Suspense>
  );
}
