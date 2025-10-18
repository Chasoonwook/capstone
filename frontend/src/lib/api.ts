// src/lib/api.ts
// ✅ API_BASE는 "루트(origin + path)"까지만. (/api 절대 붙이지 않음)
const RAW = process.env.NEXT_PUBLIC_API_BASE || "https://capstone-app-back.onrender.com";
const u = new URL(RAW.includes("://") ? RAW : `https://${RAW}`);
const ORIGIN = `${u.protocol}//${u.host}`;
const BASE_PATH = u.pathname.replace(/\/+$/, ""); // 끝 슬래시 제거

export const API_BASE = `${ORIGIN}${BASE_PATH}`; 
// 예: https://capstone-app-back.onrender.com  (뒤에 /api 없음)

// ✅ 어떤 값이 오든 결과 URL에 /api가 "정확히 1번" 들어가게 보정
export const apiUrl = (p: string) => {
  const base = /\/api$/i.test(API_BASE) ? API_BASE : `${API_BASE}/api`;
  return `${base}/${p.replace(/^\/+/, "")}`;
};

// 선택: 공통 fetch 래퍼 (쿠키/토큰 헤더 포함)
export const authHeaders = () => {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
