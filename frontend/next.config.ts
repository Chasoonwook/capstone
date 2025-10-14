// next.config.ts
import type { NextConfig } from "next";

/* ─────────────────────────────────────────────────────────
   백엔드 베이스 URL 정규화
   - 허용 입력 예:
     - http://localhost:5000
     - http://localhost:5000/api
     - https://capstone-app-back.onrender.com
     - https://capstone-app-back.onrender.com/api
   - 어떤 값이 와도 최종 목적지를 <origin>/<...>/api/spotify 로 보정
   ───────────────────────────────────────────────────────── */
function normalizeBase(raw?: string) {
  const FALLBACK = "http://localhost:5000";
  let urlStr = String(raw || FALLBACK);

  // 프로토콜이 없으면 http 붙임 (예: localhost:5000)
  if (!/^[a-z]+:\/\//i.test(urlStr)) urlStr = `http://${urlStr}`;

  // 파싱 실패 시 fallback
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    u = new URL(FALLBACK);
  }

  const origin = `${u.protocol}//${u.host}`;
  let path = (u.pathname || "/").replace(/\/+$/g, ""); // 끝 슬래시 제거
  if (!/\/api$/i.test(path)) path = `${path}/api`; // /api 보장

  return {
    origin,
    apiBasePath: path,                 // 예: /api
    apiBaseURL: `${origin}${path}`,    // 예: http://localhost:5000/api
    spotifyBaseURL: `${origin}${path}/spotify`, // 예: .../api/spotify
  };
}

const { spotifyBaseURL } = normalizeBase(process.env.NEXT_PUBLIC_API_BASE);

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

      // --- 우리 백엔드 이미지 프록시 대비(로컬/배포) ---
      { protocol: "http",  hostname: "localhost",      port: "5000", pathname: "/api/**" },
      { protocol: "http",  hostname: "localhost",      port: "5000", pathname: "/photos/**" },
      { protocol: "http",  hostname: "127.0.0.1",      port: "5000", pathname: "/api/**" },
      { protocol: "http",  hostname: "127.0.0.1",      port: "5000", pathname: "/photos/**" },
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/api/**" },
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/photos/**" },
      { protocol: "http",  hostname: "116.89.186.151", port: "31645", pathname: "/api/**" },
      { protocol: "http",  hostname: "116.89.186.151", port: "31645", pathname: "/photos/**" },
    ],
    formats: ["image/avif", "image/webp"],
  },

  /* ✅ 프록시 정책
     - 검색 계열만 프록시: /api/spotify/search, /api/spotify/search/*
     - 재생/상태(me/devices/transfer/play/pause/next/previous)는
       쿠키/자격증명 이슈로 프록시하지 않고 절대경로 + credentials:"include"로 직접 호출
  */
  async rewrites() {
    return [
      { source: "/api/spotify/search",        destination: `${spotifyBaseURL}/search` },
      { source: "/api/spotify/search/:path*", destination: `${spotifyBaseURL}/search/:path*` },
    ];
  },
};

export default nextConfig;
