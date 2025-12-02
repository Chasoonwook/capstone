// src/components/player/ClientLayout.tsx
"use client";

import { usePathname } from "next/navigation";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { GlobalNowPlayingBar } from "@/components/player/GlobalNowPlayingBar";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // PlayerProvider 적용 허용 경로 조건 정의
  const isAllowedRoute =
    pathname === "/" ||
    pathname.startsWith("/recommend") ||
    pathname.startsWith("/diary/");

  // GlobalNowPlayingBar 표시 여부 조건 정의 (메인 및 다이어리 상세 페이지)
  const showBar =
    pathname === "/" ||
    pathname.startsWith("/diary/");


  const content = (
    <>
      <div className="min-h-screen">{children}</div>
      {showBar && <GlobalNowPlayingBar />}
    </>
  );

  // 허용 경로에서 PlayerProvider 적용 결정
  return isAllowedRoute ? <PlayerProvider>{content}</PlayerProvider> : content;
}