// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// 전역 플레이어 컨텍스트 (필수)
import { PlayerProvider } from "@/contexts/PlayerContext";

// 항상 보이는 하단 플레이어 바
// ※ 너희 프로젝트에 GlobalNowPlayingBar가 이미 있으면 아래 줄을 그걸로 바꿔서 사용해도 됩니다.
// import GlobalNowPlayingBar from "@/components/NowPlayingBar";
import NowPlayingBar from "@/components/NowPlayingBar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MoodTune",
  description: "Photo mood → music",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Spotify cover 이미지 CDN들: TCP/TLS 핸드셰이크를 미리 열어둠 */}
        <link rel="preconnect" href="https://i.scdn.co" crossOrigin="" />
        <link rel="preconnect" href="https://p.scdn.co" crossOrigin="" />
        <link rel="preconnect" href="https://mosaic.scdn.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://i.scdn.co" />
        <link rel="dns-prefetch" href="https://p.scdn.co" />
        <link rel="dns-prefetch" href="https://mosaic.scdn.co" />

        {/* (선택) Apple / Deezer도 쓰면 주석 해제
        <link rel="preconnect" href="https://is1-ssl.mzstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://is2-ssl.mzstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://is3-ssl.mzstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://is4-ssl.mzstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://is5-ssl.mzstatic.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://is1-ssl.mzstatic.com" />
        <link rel="dns-prefetch" href="https://is2-ssl.mzstatic.com" />
        <link rel="dns-prefetch" href="https://is3-ssl.mzstatic.com" />
        <link rel="dns-prefetch" href="https://is4-ssl.mzstatic.com" />
        <link rel="dns-prefetch" href="https://is5-ssl.mzstatic.com" />
        <link rel="preconnect" href="https://e-cdns-images.dzcdn.net" crossOrigin="" />
        <link rel="dns-prefetch" href="https://e-cdns-images.dzcdn.net" />
        */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black`}>
        {/* 전역 플레이어 상태를 모든 페이지에 공급 */}
        <PlayerProvider>
          {/* 페이지 콘텐츠 */}
          {children}

          {/* 항상 화면 하단에 고정되는 전역 플레이어 바 */}
          <NowPlayingBar />
          {/* 만약 기존에 GlobalNowPlayingBar를 유지하고 싶다면 위 줄을 주석 처리하고 아래를 사용하세요 */}
          {/* <GlobalNowPlayingBar /> */}
        </PlayerProvider>
      </body>
    </html>
  );
}
