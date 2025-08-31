// Frontend/src/lib/api.ts (참고)
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://capstone-app-back.onrender.com";

export const authHeaders = () => {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};