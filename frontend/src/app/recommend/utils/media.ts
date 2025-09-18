import type { BackendSong } from "../types";

/** utilities */

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function parseDurationToSec(d?: string): number {
  if (!d) return 180;
  const m = /^(\d+):(\d{2})$/.exec(d);
  if (!m) return 180;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  if (Number.isNaN(mins) || Number.isNaN(secs)) return 180;
  return mins * 60 + secs;
}

/** URL → spotify:track:ID 로 정규화 (이미 URI면 그대로) */
export function toSpotifyUri(input?: string | null): string | null {
  if (!input) return null;
  if (input.startsWith("spotify:")) return input;
  const m = input.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)(\?.*)?$/);
  return m ? `spotify:track:${m[1]}` : null;
}

/** 추천 응답 → BackendSong[] 안전 필터 */
export const toBackendSongArray = (v: unknown): BackendSong[] =>
  Array.isArray(v) ? v.filter(isBackendSong) : [];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isBackendSong = (v: unknown): v is BackendSong => {
  if (!isRecord(v)) return false;
  const { music_id, id, title, artist, label, genre, duration, duration_sec } = v as Record<string, unknown>;
  const isOptStr = (x: unknown) => typeof x === "string" || typeof x === "undefined" || x === null;
  const isOptStrOrNum = (x: unknown) => typeof x === "string" || typeof x === "number" || typeof x === "undefined";
  const isOptNum = (x: unknown) => typeof x === "number" || typeof x === "undefined";
  return (
    isOptStrOrNum(music_id) &&
    isOptStrOrNum(id) &&
    isOptStr(title) &&
    isOptStr(artist) &&
    isOptStr(label) &&
    isOptStr(genre) &&
    isOptNum(duration) &&
    isOptNum(duration_sec)
  );
};

/** 프리뷰/커버/URI 보강(서버 라우트들과 통신) */
export type PreviewSource = "spotify" | "itunes" | "deezer" | null;

export async function resolvePreviewAndCover(
  title?: string,
  artist?: string
): Promise<{ preview: string | null; cover: string | null; uri: string | null; source: PreviewSource }> {
  const sp = await findSpotifyInfo(title, artist);
  if (sp.preview) return { preview: sp.preview, cover: sp.cover, uri: sp.uri, source: "spotify" };

  const it = await findItunesPreview(title, artist);
  if (it.preview) return { preview: it.preview, cover: it.cover, uri: sp.uri ?? null, source: "itunes" };

  const dz = await findDeezerPreview(title, artist);
  if (dz.preview) return { preview: dz.preview, cover: dz.cover, uri: sp.uri ?? null, source: "deezer" };

  return { preview: null, cover: sp.cover ?? it.cover ?? dz.cover ?? null, uri: sp.uri ?? null, source: null };
}

async function findSpotifyInfo(title?: string, artist?: string) {
  const term = [title ?? "", artist ?? ""].join(" ").trim();
  if (!term) return { uri: null as string | null, preview: null as string | null, cover: null as string | null };

  // 1) query 방식
  try {
    const u1 = new URL("/api/spotify/search", window.location.origin);
    u1.searchParams.set("query", term);
    u1.searchParams.set("markets", "KR,US,JP,GB,DE,FR,CA,AU,BR,MX,SE,NL,ES,IT");
    u1.searchParams.set("limit", "5");
    const r1 = await fetch(u1.toString(), { cache: "no-store" });
    if (r1.ok) {
      const js = await r1.json();
      if (js?.items?.length) {
        const f = js.items[0];
        return {
          uri: toSpotifyUri(f?.trackId ? `spotify:track:${f.trackId}` : f?.uri ?? null),
          preview: f?.previewUrl ?? f?.preview_url ?? null,
          cover: f?.albumImage ?? f?.image ?? null,
        };
      }
      if (js?.ok) {
        return {
          uri: toSpotifyUri(js.uri ?? null),
          preview: js.preview_url ?? null,
          cover: js.image ?? null
        };
      }
    }
  } catch {}

  // 2) title/artist 방식
  try {
    const u2 = new URL("/api/spotify/search", window.location.origin);
    if (title) u2.searchParams.set("title", title);
    if (artist) u2.searchParams.set("artist", artist);
    u2.searchParams.set("limit", "5");
    const r2 = await fetch(u2.toString(), { cache: "no-store" });
    if (!r2.ok) return { uri: null, preview: null, cover: null };
    const js2 = await r2.json();

    const first =
      js2?.items?.[0] ??
      (js2?.tracks?.items?.[0] && {
        trackId: js2.tracks.items[0].id,
        previewUrl: js2.tracks.items[0].preview_url,
        albumImage:
          js2.tracks.items[0].album?.images?.[0]?.url ??
          js2.tracks.items[0].album?.images?.[1]?.url ??
          js2.tracks.items[0].album?.images?.[2]?.url ??
          null,
      });

    return {
      uri: toSpotifyUri(first?.trackId ? `spotify:track:${first.trackId}` : first?.uri ?? null),
      preview: first?.previewUrl ?? first?.preview_url ?? null,
      cover: first?.albumImage ?? first?.image ?? null,
    };
  } catch {
    return { uri: null, preview: null, cover: null };
  }
}

async function findItunesPreview(title?: string, artist?: string) {
  const term = [title ?? "", artist ?? ""].join(" ").trim();
  if (!term) return { preview: null, cover: null };
  try {
    const r = await fetch(`/api/preview/itunes?term=${encodeURIComponent(term)}`, { cache: "no-store" });
    if (!r.ok) return { preview: null, cover: null };
    const js = await r.json();
    return js?.ok ? { preview: js.preview_url ?? null, cover: js.image ?? null }
                  : { preview: null, cover: null };
  } catch { return { preview: null, cover: null }; }
}

async function findDeezerPreview(title?: string, artist?: string) {
  const term = [title ?? "", artist ?? ""].join(" ").trim();
  if (!term) return { preview: null, cover: null };
  try {
    const r = await fetch(`/api/preview/deezer?term=${encodeURIComponent(term)}`, { cache: "no-store" });
    if (!r.ok) return { preview: null, cover: null };
    const js = await r.json();
    return js?.ok ? { preview: js.preview_url ?? null, cover: js.image ?? null }
                  : { preview: null, cover: null };
  } catch { return { preview: null, cover: null }; }
}
