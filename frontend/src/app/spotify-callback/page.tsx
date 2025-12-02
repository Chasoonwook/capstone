"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic"; // 프리렌더 방지 목적

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    // 목적지 경로 복귀 동작
    const dest = sp.get("r") || "/";
    const safe = dest.startsWith("/") && !dest.startsWith("//") ? dest : "/";
    router.replace(safe);
  }, [router, sp]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      Finalizing Spotify connection...
    </div>
  );
}

export default function SpotifyCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Checking connection information...
        </div>
      }
    >
      <Inner />
    </Suspense>
  );
}