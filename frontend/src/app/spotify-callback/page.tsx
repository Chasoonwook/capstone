// src/app/spotify-callback/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// 필요하면 유지해도 무방
export const dynamic = "force-dynamic";

export default function SpotifyCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    // 백엔드에서 ?ok=1/0 로 결과만 알려줌
    const ok = sp.get("ok");
    // 성공/실패 여부에 따라 토스트를 띄우고 싶다면 여기에 처리
    // 쿠키는 이미 백엔드에서 설정됨
    router.replace("/recommend"); // 원하는 이동 경로로 변경
  }, [router, sp]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      스포티파이 연동을 마무리하는 중입니다…
    </div>
  );
}
