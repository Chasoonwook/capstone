"use client";

import { usePathname } from "next/navigation";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { GlobalNowPlayingBar } from "@/components/player/GlobalNowPlayingBar";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // recommend 페이지에서는 하단바 숨김
  const showBar = !pathname?.startsWith("/recommend");

  return (
    <PlayerProvider>
      {/* 페이지 콘텐츠 */}
      <div className="min-h-screen">{children}</div>

      {/* 전역 하단 내비게이션(플레이어 바) */}
      {showBar && <GlobalNowPlayingBar />}
    </PlayerProvider>
  );
}
