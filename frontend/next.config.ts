// next.config.ts
import type { NextConfig } from "next";

/** ─────────────────────────────────────────────────────────
 *  백엔드 베이스 URL 정규화
 *  - 예: http://localhost:5000  | http://localhost:5000/api | https://capstone-app-back.onrender.com/api
 *  - 어떤 값이든 받아서 항상  <origin>/<...>/api/spotify 로 목적지를 만들도록 보정
 *  ───────────────────────────────────────────────────────── */
const RAW = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000/api";
const parsed = new URL(RAW.includes("://") ? RAW : `http://localhost:5000/api`);
const ORIGIN = `${parsed.protocol}//${parsed.host}`;
let basePath = parsed.pathname.replace(/\/+$/, ""); // 끝 슬래시 제거
if (!/\/api$/i.test(basePath)) basePath = `${basePath}/api`; // /api 없으면 추가

// 최종 목적지: <origin><basePath>/spotify (예: http://localhost:5000/api/spotify)
const DEST_SPOTIFY = `${ORIGIN}${basePath}/spotify`;

const nextConfig: NextConfig = {
  compiler: { styledComponents: true },

  images: {
    remotePatterns: [
      // --- Spotify cover CDNs ---
      { protocol: "https", hostname: "i.scdn.co", pathname: "/**" },
      { protocol: "https", hostname: "p.scdn.co", pathname: "/**" },
      { protocol: "https", hostname: "mosaic.scdn.co", pathname: "/**" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com", pathname: "/**" },

      // --- Apple (iTunes) cover CDNs ---
      { protocol: "https", hostname: "is1-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is2-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is3-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is4-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is5-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "audio-ssl.itunes.apple.com", pathname: "/**" },

      // --- Deezer cover CDNs ---
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net", pathname: "/**" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net", pathname: "/**" },

      // --- 우리 백엔드(로컬/배포) 이미지 프록시 대비 ---
      { protocol: "http",  hostname: "localhost",              port: "5000", pathname: "/api/**" },
      { protocol: "http",  hostname: "localhost",              port: "5000", pathname: "/photos/**" },
      { protocol: "http",  hostname: "127.0.0.1",              port: "5000", pathname: "/api/**" },
      { protocol: "http",  hostname: "127.0.0.1",              port: "5000", pathname: "/photos/**" },
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/api/**" },
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/photos/**" },
      { protocol: "http",  hostname: "116.89.186.151",         port: "31645", pathname: "/api/**" },
      { protocol: "http",  hostname: "116.89.186.151",         port: "31645", pathname: "/photos/**" },
    ],
    formats: ["image/avif", "image/webp"],
  },

  /** ✅ 프론트의 /api/spotify/search* → 백엔드 /api/spotify/search* 로만 프록시
   *  (재생/상태 계열은 쿠키 문제 때문에 프록시 금지: 절대경로 + credentials:"include"로 호출)
   */
  async rewrites() {
    return [
      { source: "/api/spotify/search",        destination: `${DEST_SPOTIFY}/search` },
      { source: "/api/spotify/search/:path*", destination: `${DEST_SPOTIFY}/search/:path*` },
    ];
  },
};

export default nextConfig;
