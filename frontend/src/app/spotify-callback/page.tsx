"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

// 프리렌더하지 말고 동적으로 처리
export const dynamic = "force-dynamic";

function CallbackInner() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    // 백엔드가 ?ok=1/0 으로 결과만 넘김. 쿠키는 이미 설정됨.
    const ok = sp.get("ok");
    // 필요하면 ok 값으로 토스트 띄우고…
    router.replace("/recommend"); // 이동 경로는 원하는 곳으로
  }, [router, sp]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      스포티파이 연동을 마무리하는 중입니다…
    </div>
  );
}

export default function SpotifyCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        연동 정보를 읽는 중…
      </div>
    }>
      <CallbackInner />
    </Suspense>
  );
}
