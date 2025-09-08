// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: { styledComponents: true },
  images: {
    remotePatterns: [
      // Spotify 이미지
      { protocol: "https", hostname: "i.scdn.co", pathname: "/**" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com", pathname: "/**" },

      // 로컬 백엔드 (둘 다 허용)
      { protocol: "http", hostname: "localhost", port: "5000", pathname: "/api/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "5000", pathname: "/api/**" },

      // 배포 백엔드 (실제 도메인으로 교체)
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/api/**" },

      // (선택) IP로 접근하는 경우가 있다면
      { protocol: "http", hostname: "116.89.186.151", port: "31645", pathname: "/api/**" },
    ],
  },
};

export default nextConfig;
