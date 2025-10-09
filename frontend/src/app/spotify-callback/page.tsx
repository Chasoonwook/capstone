"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic"; // 프리렌더 방지

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    // 서버에서 전달된 목적지(r)로 복귀. 없으면 "/"
    const dest = sp.get("r") || "/"; 
    // 안전장치: 외부 URL 방지(반드시 슬래시로 시작하는 내부 경로만)
    const safe = dest.startsWith("/") && !dest.startsWith("//") ? dest : "/";
    router.replace(safe);
  }, [router, sp]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      스포티파이 연동을 마무리하는 중입니다…
    </div>
  );
}

export default function SpotifyCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          연동 정보를 확인하는 중…
        </div>
      }
    >
      <Inner />
    </Suspense>
  );
}
