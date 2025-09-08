// src/app/api/spotify/search/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/* --------- 타입 --------- */
type SpotifyImage = { url: string; height?: number; width?: number };
type SpotifyArtist = { id: string; name: string };
type SpotifyAlbum  = { images?: SpotifyImage[] };
type SpotifyTrack  = {
  id: string;
  name: string;
  uri: string;
  preview_url?: string | null;
  artists?: SpotifyArtist[];
  album?: SpotifyAlbum;
};
type SpotifySearchResponse = {
  tracks?: {
    items: SpotifyTrack[];
    total?: number;
  };
};

/* ----- 앱 토큰(클라이언트 자격증명) 캐시 ----- */
type AppTok = { accessToken: string; expiresAt: number };
const g = globalThis as unknown as { __spAppTok?: AppTok };

async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (g.__spAppTok && g.__spAppTok.expiresAt - 10_000 > now) {
    return g.__spAppTok.accessToken;
  }
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("missing_spotify_env");
  }
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!r.ok) throw new Error("spotify_app_token_fail");
  const js: { access_token: string; expires_in?: number } = await r.json();
  g.__spAppTok = {
    accessToken: js.access_token,
    expiresAt: Date.now() + (js.expires_in ?? 3600) * 1000,
  };
  return g.__spAppTok.accessToken;
}

/* ----- 유틸 ----- */
const pickImage = (t: SpotifyTrack): string | null => {
  const imgs = t.album?.images ?? [];
  return imgs[1]?.url ?? imgs[0]?.url ?? imgs[2]?.url ?? null;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("query")?.trim();
  const marketsParam = req.nextUrl.searchParams.get("markets") || "KR,US,JP,GB";
  const limit = Math.max(1, Math.min(5, Number(req.nextUrl.searchParams.get("limit") ?? "5")));
  if (!q) return NextResponse.json({ ok: false, reason: "missing_query" }, { status: 400 });

  try {
    const token = await getAppToken();
    const markets = marketsParam
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);

    for (const market of markets) {
      const url = new URL("https://api.spotify.com/v1/search");
      url.searchParams.set("q", q);
      url.searchParams.set("type", "track");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("market", market);

      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) continue;

      const js: SpotifySearchResponse = await r.json();
      const items: SpotifyTrack[] = js?.tracks?.items ?? [];
      if (!items.length) continue;

      const withPreview = items.find((t: SpotifyTrack) => Boolean(t.preview_url));
      const chosen = withPreview || items[0];

      return NextResponse.json({
        ok: true,
        market,
        id: chosen?.id ?? null,
        name: chosen?.name ?? null,
        uri: chosen?.uri ?? null,
        preview_url: chosen?.preview_url ?? null,
        image: pickImage(chosen),
        items: items.map((x: SpotifyTrack) => ({
          id: x.id,
          name: x.name,
          uri: x.uri,
          preview_url: x.preview_url ?? null,
          image: pickImage(x),
          artists: (x.artists ?? []).map((a: SpotifyArtist) => a.name),
        })),
        total: js?.tracks?.total ?? items.length,
      });
    }

    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  } catch {
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
