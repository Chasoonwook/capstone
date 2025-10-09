// src/app/recommend/utils/media.ts
import { API_BASE } from "@/lib/api";

// 트랙/커버/미리듣기 찾기
export async function resolvePreviewAndCover(title: string, artist: string) {
  const q = `${title} ${artist}`.trim();
  const url = `${API_BASE}/api/spotify/search?q=${encodeURIComponent(q)}&type=track&limit=1`;

  const r = await fetch(url, { method: "GET", credentials: "include", cache: "no-store" });
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

// 헬퍼: Spotify URI 통일
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
