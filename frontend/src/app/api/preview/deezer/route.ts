import { NextRequest, NextResponse } from "next/server";

type DeezerAlbum = { cover_medium?: string; cover?: string };
type DeezerTrack = { preview?: string; album?: DeezerAlbum };
type DeezerSearchResponse = { data?: DeezerTrack[] };

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const term = searchParams.get("term") ?? "";
  if (!term.trim()) {
    return NextResponse.json({ ok: false, reason: "empty" }, { status: 400 });
  }

  const api = new URL("https://api.deezer.com/search");
  api.searchParams.set("q", term);
  api.searchParams.set("limit", "1");

  const r = await fetch(api.toString(), { cache: "no-store" });
  if (!r.ok) {
    return NextResponse.json({ ok: false }, { status: r.status });
  }

  const js = (await r.json()) as DeezerSearchResponse;
  const item = Array.isArray(js.data) ? js.data[0] : undefined;

  const preview_url = item?.preview ?? null;
  const image = item?.album?.cover_medium ?? item?.album?.cover ?? null;

  return NextResponse.json({ ok: true, preview_url, image });
}
