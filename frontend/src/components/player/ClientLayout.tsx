"use client";

import { usePathname } from "next/navigation";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { GlobalNowPlayingBar } from "@/components/player/GlobalNowPlayingBar";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 🔐 재생 허용 경로(컨텍스트 활성화): 메인(/), recommend, diary
  const isAllowedRoute =
    pathname === "/" ||
    pathname.startsWith("/recommend") ||
    pathname.startsWith("/diary/");

  // 🎛️ 하단 재생바는 diary 페이지만 표시
  const showBar = pathname.startsWith("/diary/");

  const content = (
    <>
      <div className="min-h-screen">{children}</div>
      {showBar && <GlobalNowPlayingBar />}
    </>
  );

  // 허용 경로에서만 PlayerProvider 적용
  return isAllowedRoute ? <PlayerProvider>{content}</PlayerProvider> : content;
}
