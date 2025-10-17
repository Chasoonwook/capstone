// src/app/layout.tsx
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import ClientLayout from "@/components/player/ClientLayout"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "MoodTune",
  description: "Photo mood → music",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Spotify cover 이미지 CDN 프리커넥트/프리페치 */}
        <link rel="preconnect" href="https://i.scdn.co" crossOrigin="" />
        <link rel="preconnect" href="https://p.scdn.co" crossOrigin="" />
        <link rel="preconnect" href="https://mosaic.scdn.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://i.scdn.co" />
        <link rel="dns-prefetch" href="https://p.scdn.co" />
        <link rel="dns-prefetch" href="https://mosaic.scdn.co" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* 🔒 전역 플레이어/하단바는 여기서만 관리 */}
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
