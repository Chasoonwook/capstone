// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    styledComponents: true, // styled-components 활성화
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "127.0.0.1", // 로컬 API 서버
        port: "5000",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "your-backend.onrender.com", // Render 배포 도메인 등
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "116.89.186.151", // 필요하면 실제 서버 IP도 추가
        port: "31645",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
