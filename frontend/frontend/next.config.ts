// next.config.ts
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'capstone-app-back.onrender.com' },
    ],
  },
};
export default nextConfig;
