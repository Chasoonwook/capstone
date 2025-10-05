// 파일 경로: src/app/spotify-callback/page.tsx

"use client";

import { useEffect, Suspense } from "react"; // Suspense 추가
import { useSearchParams, useRouter } from "next/navigation";

// ✅ [수정] 이 페이지를 동적 렌더링으로 강제하는 코드를 추가합니다.
export const dynamic = "force-dynamic";

function SpotifyCallback() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");
    const expiresIn = searchParams.get("expires_in");

    if (accessToken) {
      localStorage.setItem("spotify_access_token", accessToken);
      if (refreshToken) {
        localStorage.setItem("spotify_refresh_token", refreshToken);
      }
      
      const expiresAt = Date.now() + Number(expiresIn) * 1000;
      localStorage.setItem("spotify_token_expires_at", String(expiresAt));

      // alert("Spotify 연동에 성공했습니다!"); // 페이지 이동 전에 alert가 있으면 UX에 좋지 않을 수 있어 주석 처리
      router.replace("/");
      
    } else {
      const error = searchParams.get("error");
      console.error("Spotify callback error:", error);
      alert("Spotify 연동에 실패했습니다.");
      router.replace("/");
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <p>Spotify와 연동 중입니다. 잠시만 기다려주세요...</p>
    </div>
  );
}

// ✅ [수정] Suspense로 컴포넌트를 감싸줍니다.
export default function SpotifyCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">연동 정보를 읽어오는 중...</div>}>
      <SpotifyCallback />
    </Suspense>
  );
}