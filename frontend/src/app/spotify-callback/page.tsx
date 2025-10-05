// 파일 경로: src/app/spotify-callback/page.tsx

"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function SpotifyCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    // 1. URL 주소에서 access_token과 refresh_token을 가져옵니다.
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");
    const expiresIn = searchParams.get("expires_in");

    if (accessToken) {
      // 2. 토큰들을 localStorage에 저장합니다.
      localStorage.setItem("spotify_access_token", accessToken);
      if (refreshToken) {
        localStorage.setItem("spotify_refresh_token", refreshToken);
      }
      
      // 3. (선택사항) 토큰 만료 시간도 저장해두면 나중에 갱신할 때 유용합니다.
      const expiresAt = Date.now() + Number(expiresIn) * 1000;
      localStorage.setItem("spotify_token_expires_at", String(expiresAt));

      // 4. 토큰 저장이 끝나면 메인 페이지로 이동시킵니다.
      alert("Spotify 연동에 성공했습니다!");
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