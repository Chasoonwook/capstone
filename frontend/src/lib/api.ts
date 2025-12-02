// src/lib/api.ts
const RAW = process.env.NEXT_PUBLIC_API_BASE || "https://capstone-app-back.onrender.com";
const u = new URL(RAW.includes("://") ? RAW : `https://${RAW}`);
const ORIGIN = `${u.protocol}//${u.host}`;
const BASE_PATH = u.pathname.replace(/\/+$/, "");

// API 기본 경로 설정 (Origin + Path)
export const API_BASE = `${ORIGIN}${BASE_PATH}`;
// 예시: https://capstone-app-back.onrender.com (뒤에 /api 없음)

// URL 경로 보정 및 구성 처리
export const apiUrl = (p: string) => {
  // BASE 경로에 /api 포함 여부 확인 및 보정
  const base = /\/api$/i.test(API_BASE) ? API_BASE : `${API_BASE}/api`;
  // 최종 URL 생성 (입력 경로의 시작 슬래시 제거)
  return `${base}/${p.replace(/^\/+/, "")}`;
};

// 공통 fetch 헤더 구성 (토큰 포함)
export const authHeaders = () => {
  // 서버 측 렌더링 환경 확인
  if (typeof window === "undefined") return {};
  // 로컬 스토리지에서 토큰 조회
  const t = localStorage.getItem("token");
  // 토큰 존재 시 Authorization 헤더 반환
  return t ? { Authorization: `Bearer ${t}` } : {};
};