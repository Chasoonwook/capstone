"use client"

import { usePathname } from "next/navigation"
import dynamic from "next/dynamic"

// GlobalNowPlayingBar가 이 폴더에 있다면 아래 상대경로가 맞습니다.
// 파일이 없다면 일단 이 줄을 주석처리해도 됩니다.
const GlobalNowPlayingBar = dynamic(
  () => import("./GlobalNowPlayingBar").then(m => m.GlobalNowPlayingBar),
  { ssr: false }
)

const HIDE_ON: string[] = ["/recommend"] // 이 경로들에서는 전역 바 숨김

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideBar = HIDE_ON.some(p => pathname.startsWith(p))

  return (
    <>
      {children}
      {!hideBar && <GlobalNowPlayingBar />}
    </>
  )
}
