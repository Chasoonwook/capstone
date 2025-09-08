import { NextRequest, NextResponse } from "next/server";

type ItunesItem = { previewUrl?: string; artworkUrl100?: string };
type ItunesResponse = { resultCount?: number; results?: ItunesItem[] };

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const term = searchParams.get("term") ?? "";
  const country = searchParams.get("country") ?? "KR";
  if (!term.trim()) {
    return NextResponse.json({ ok: false, reason: "empty" }, { status: 400 });
  }

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "1");
  url.searchParams.set("country", country);

  const r = await fetch(url.toString(), { cache: "no-store" });
  if (!r.ok) {
    return NextResponse.json({ ok: false }, { status: r.status });
  }

  const js = (await r.json()) as ItunesResponse;
  const item = Array.isArray(js.results) ? js.results[0] : undefined;

  const preview_url = item?.previewUrl ?? null;
  const image = item?.artworkUrl100
    ? item.artworkUrl100.replace("100x100bb.jpg", "300x300bb.jpg")
    : null;

  return NextResponse.json({ ok: true, preview_url, image });
}
