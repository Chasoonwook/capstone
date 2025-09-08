// next.config.ts
import type { NextConfig } from "next";

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
      // next/image는 hostname 와일드카드가 안 되므로 1~5 모두 명시
      { protocol: "https", hostname: "is1-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is2-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is3-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is4-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is5-ssl.mzstatic.com", pathname: "/**" },

      // --- Deezer cover CDN ---
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net", pathname: "/**" },

      // --- 우리 백엔드(로컬)에서 이미지 바이너리 프록시할 때 ---
      { protocol: "http", hostname: "localhost", port: "5000", pathname: "/api/**" },
      { protocol: "http", hostname: "localhost", port: "5000", pathname: "/photos/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "5000", pathname: "/api/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "5000", pathname: "/photos/**" },

      // --- 우리 백엔드(배포) ---
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/api/**" },
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/photos/**" },

      // --- (옵션) IP로 접근할 때 ---
      { protocol: "http", hostname: "116.89.186.151", port: "31645", pathname: "/api/**" },
      { protocol: "http", hostname: "116.89.186.151", port: "31645", pathname: "/photos/**" },
    ],
    // (선택) 이미지 포맷 최적화
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
