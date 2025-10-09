import { API_BASE } from "@/lib/api";

/** Spotify 검색: 제목+아티스트로 uri/preview/cover 추출 */
export async function resolvePreviewAndCover(title: string, artist: string) {
  const q = `${title} ${artist}`.trim();
  const url = `${API_BASE}/api/spotify/search?q=${encodeURIComponent(q)}&type=track&limit=1`;

  const r = await fetch(url, {
    method: "GET",
    credentials: "include", // 쿠키 동봉 필수
    cache: "no-store",
  });
  if (!r.ok) throw new Error("spotify search failed");

  const data = await r.json();
  const item = data?.tracks?.items?.[0];

  const uri = item?.uri ?? null;
  const preview = item?.preview_url ?? null;
  const cover =
    item?.album?.images?.[0]?.url ??
    item?.album?.images?.[1]?.url ??
    item?.album?.images?.[2]?.url ??
    null;

  return { uri, preview, cover };
}

/** 다양한 입력을 spotify:track:ID 형태로 정규화 */
export function toSpotifyUri(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("spotify:track:")) return v;
  if (v.startsWith("https://open.spotify.com/track/")) {
    const id = v.split("/track/")[1]?.split(/[?#]/)[0];
    return id ? `spotify:track:${id}` : null;
  }
  if (/^[0-9A-Za-z]{22}$/.test(v)) return `spotify:track:${v}`;
  return null;
}

/** "mm:ss" 혹은 number(초)를 안전하게 초단위 number로 변환 */
export function parseDurationToSec(input: string | number | null | undefined): number {
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  const s = String(input ?? "").trim();
  // "m:ss" 또는 "mm:ss"
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) {
    const mm = parseInt(m[1], 10);
    const ss = parseInt(m[2], 10);
    return mm * 60 + ss;
  }
  // 실패 시 기본 180초(3분)
  return 180;
}

/** 초 → "m:ss" 포맷 */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
