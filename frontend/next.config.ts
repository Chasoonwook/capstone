// next.config.ts
import type { NextConfig } from "next";

/* 베이스 URL 정규화 */
function normalizeBase(raw?: string) {
  const FALLBACK = "http://localhost:5000";
  let urlStr = String(raw || FALLBACK);
  if (!/^[a-z]+:\/\//i.test(urlStr)) urlStr = `http://${urlStr}`;
  let u: URL;
  try { u = new URL(urlStr); } catch { u = new URL(FALLBACK); }

  const origin = `${u.protocol}//${u.host}`;
  let path = (u.pathname || "/").replace(/\/+$/g, "");
  if (!/\/api$/i.test(path)) path = `${path}/api`;

  return {
    origin,
    apiBasePath: path,
    apiBaseURL: `${origin}${path}`,
    spotifyBaseURL: `${origin}${path}/spotify`,
  };
}

const { spotifyBaseURL } = normalizeBase(process.env.NEXT_PUBLIC_API_BASE);

const nextConfig: NextConfig = {
  compiler: { styledComponents: true },

  images: {
    remotePatterns: [
      // Spotify cover CDNs
      { protocol: "https", hostname: "i.scdn.co", pathname: "/**" },
      { protocol: "https", hostname: "p.scdn.co", pathname: "/**" },
      { protocol: "https", hostname: "mosaic.scdn.co", pathname: "/**" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com", pathname: "/**" },

      // Apple / Deezer (폴백 대비)
      { protocol: "https", hostname: "is1-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is2-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is3-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is4-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "is5-ssl.mzstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net", pathname: "/**" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net", pathname: "/**" },

      // 우리 백엔드 이미지 프록시(로컬/배포)
      { protocol: "http",  hostname: "localhost", port: "5000", pathname: "/api/**" },
      { protocol: "http",  hostname: "localhost", port: "5000", pathname: "/photos/**" },
      { protocol: "http",  hostname: "127.0.0.1", port: "5000", pathname: "/api/**" },
      { protocol: "http",  hostname: "127.0.0.1", port: "5000", pathname: "/photos/**" },
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/api/**" },
      { protocol: "https", hostname: "capstone-app-back.onrender.com", pathname: "/photos/**" },
      { protocol: "http",  hostname: "116.89.186.151", port: "31645", pathname: "/api/**" },
      { protocol: "http",  hostname: "116.89.186.151", port: "31645", pathname: "/photos/**" },
    ],
    formats: ["image/avif", "image/webp"],
  },

  // 검색 계열만 프록시 (쿠키 필요 없는 호출)
  async rewrites() {
    return [
      // 기존: 검색
      { source: "/api/spotify/search",        destination: `${spotifyBaseURL}/search` },
      { source: "/api/spotify/search/:path*", destination: `${spotifyBaseURL}/search/:path*` },

      // 추가: 단일 트랙 상세 (커버/미리듣기 확보용)
      { source: "/api/spotify/tracks/:id",    destination: `${spotifyBaseURL}/tracks/:id` },
    ];
  },
};

export default nextConfig;
