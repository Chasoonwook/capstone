import { API_BASE } from "@/lib/api";

// Spotify 검색 결과 파싱 로직 정의
export async function resolvePreviewAndCover(title: string, artist: string) {
  // 검색어 구성
  const q = `${title} ${artist}`.trim();
  const url = `${API_BASE}/api/spotify/search?q=${encodeURIComponent(q)}&type=track&limit=1`;

  // Spotify 프록시 검색 요청
  const r = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  if (!r.ok) throw new Error("spotify search failed");

  // 검색 결과 데이터 파싱
  const data = await r.json();
  const item = data?.tracks?.items?.[0];

  // 주요 필드 추출
  const uri = item?.uri ?? null;
  const preview = item?.preview_url ?? null;
  const cover =
    item?.album?.images?.[0]?.url ||
    item?.album?.images?.[1]?.url ||
    item?.album?.images?.[2]?.url ||
    null;

  return { uri, preview, cover };
}

// Spotify URI 정규화 로직 정의
export function toSpotifyUri(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("spotify:track:")) return v;
  if (v.startsWith("https://open.spotify.com/track/")) {
    // URL 기반 track ID 추출
    const id = v.split("/track/")[1]?.split(/[?#]/)[0];
    return id ? `spotify:track:${id}` : null;
  }
  // 순수 ID 형태 처리
  if (/^[0-9A-Za-z]{22}$/.test(v)) return `spotify:track:${v}`;
  return null;
}

// 문자열 또는 숫자 입력을 초 단위 정수로 변환
export function parseDurationToSec(input: string | number | null | undefined): number {
  // 숫자 기반 입력 처리
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.max(0, Math.floor(input));
  }

  const s = String(input ?? "").trim();

  // m:ss 또는 mm:ss 패턴 처리
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) {
    const mm = parseInt(m[1], 10);
    const ss = parseInt(m[2], 10);
    return mm * 60 + ss;
  }

  // 변환 실패 시 기본값 반환
  return 180;
}

// 초 단위를 "m:ss" 문자열 포맷으로 변환
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}