"use client";

import { usePathname } from "next/navigation";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { GlobalNowPlayingBar } from "@/components/player/GlobalNowPlayingBar";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 메인 페이지("/")에서만 하단바 표시
  const showBar = pathname === "/";

  return (
    <PlayerProvider>
      {/* 페이지 콘텐츠 */}
      <div className="min-h-screen">{children}</div>

      {/* 전역 하단 내비게이션(플레이어 바) */}
      {showBar && <GlobalNowPlayingBar />}
    </PlayerProvider>
  );
}
