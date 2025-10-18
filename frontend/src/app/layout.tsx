import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientLayout from "@/components/player/ClientLayout";
import { SpotifyStatusProvider } from "../contexts/SpotifyStatusContext";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MoodTune",
  description: "Photo mood → music",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Spotify CDN preconnect 설정 유지 */}
        <link rel="preconnect" href="https://i.scdn.co" crossOrigin="" />
        <link rel="preconnect" href="https://p.scdn.co" crossOrigin="" />
        <link rel="preconnect" href="https://mosaic.scdn.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://i.scdn.co" />
        <link rel="dns-prefetch" href="https://p.scdn.co" />
        <link rel="dns-prefetch" href="https://mosaic.scdn.co" />
      </head>

      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* ✅ SpotifyStatusProvider가 앱 전체를 감싸고,
            내부에 ClientLayout이 children을 관리하도록 */}
        <SpotifyStatusProvider>
          <ClientLayout>{children}</ClientLayout>
        </SpotifyStatusProvider>
      </body>
    </html>
  );
}
