import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";

const pickCover = (x: any) =>
  x?.album?.cover_medium || x?.album?.cover_big || x?.album?.cover || null;

async function tryQuery(q: string) {
  const url = new URL("https://api.deezer.com/search");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  const r = await fetch(url.toString(), { cache: "no-store" });
  if (!r.ok) return null;
  const js = await r.json();
  const items: any[] = js?.data ?? [];
  const hit = items.find((t) => !!t?.preview) || items[0];
  if (!hit?.preview) return null;
  return {
    preview_url: hit.preview as string,
    image: pickCover(hit),
    id: hit.id,
    title: hit.title,
    artist: hit?.artist?.name ?? null,
  };
}

export async function GET(req: NextRequest) {
  const term = (req.nextUrl.searchParams.get("term") || "").trim();
  if (!term) return NextResponse.json({ ok: false, reason: "missing_term" }, { status: 400 });

  // 정확도 높이기 위해 두 번 정도 질의
  const variants = [
    term,
    term.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s+/g, " ").trim(),
  ];

  for (const v of variants) {
    const hit = await tryQuery(v);
    if (hit) return NextResponse.json({ ok: true, source: "deezer", ...hit });
  }
  return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
}
