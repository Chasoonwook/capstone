// src/app/api/spotify/search/route.ts
import { NextResponse } from "next/server";

async function fetchToken() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/spotify/token`, { cache: "no-store" });
  if (!res.ok) throw new Error("token_fetch_failed");
  const js = await res.json();
  return js.access_token as string;
}

function buildQuery(title?: string | null, artist?: string | null, query?: string | null) {
  if (query) return query;
  const parts: string[] = [];
  if (title) parts.push(`track:${title}`);
  if (artist) parts.push(`artist:${artist}`);
  return parts.join(" ") || "";
}

async function doSearch(token: string, q: string, limit = 5) {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  return res;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const title = searchParams.get("title");
    const artist = searchParams.get("artist");
    const query = searchParams.get("query");
    const limit = Number(searchParams.get("limit") ?? 5);

    const q = buildQuery(title, artist, query);
    if (!q) return NextResponse.json({ items: [] });

    let token = await fetchToken();
    let res = await doSearch(token, q, limit);

    // 401이면 토큰 갱신 후 1회 재시도
    if (res.status === 401) {
      token = await fetchToken();
      res = await doSearch(token, q, limit);
    }
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: "spotify_search_failed", status: res.status, detail: text }, { status: 500 });
    }

    const js = await res.json();
    const items =
      js?.tracks?.items?.map((t: any) => ({
        trackId: t.id,
        title: t.name,
        artist: t.artists?.map((a: any) => a.name).join(", "),
        albumImage: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url || t.album?.images?.[2]?.url || null,
        previewUrl: t.preview_url ?? null,
        uri: t.uri ?? null,
      })) ?? [];

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "search_error" }, { status: 500 });
  }
}
