// src/lib/api.ts
const RAW = process.env.NEXT_PUBLIC_API_BASE || "https://capstone-app-back.onrender.com";

// 항상 /api 로 끝나도록 보정
const url = new URL(RAW.includes("://") ? RAW : `https://${RAW}`);
let path = url.pathname.replace(/\/+$/, ""); // 끝 슬래시 제거
if (!/\/api$/i.test(path)) path = `${path}/api`;
url.pathname = path;

export const API_BASE = `${url.protocol}//${url.host}${url.pathname}`;
// 예: https://capstone-app-back.onrender.com/api

export const authHeaders = () => {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
