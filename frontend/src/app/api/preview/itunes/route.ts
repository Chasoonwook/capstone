import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";

// 불필요 토큰/괄호/피처 제거
const sanitize = (s: string) =>
  s.replace(/\(.*?\)|\[.*?\]/g, " ")
   .replace(/feat\.?|ft\.?/gi, " ")
   .replace(/\s+/g, " ")
   .trim();

async function search(term: string, country: string) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "3");
  url.searchParams.set("country", country);
  const r = await fetch(url.toString(), { cache: "no-store" });
  if (!r.ok) return null;
  const js = await r.json();
  const item = Array.isArray(js?.results) ? js.results.find((x: any) => x?.previewUrl) : null;
  if (!item) return null;
  const cover =
    (item.artworkUrl100 as string | undefined)?.replace("100x100bb.jpg", "300x300bb.jpg") ?? null;
  return { preview_url: item.previewUrl as string, image: cover, country };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("term") || "";
  if (!raw.trim()) return NextResponse.json({ ok: false, reason: "missing_term" }, { status: 400 });

  const base = sanitize(raw);
  // 우선순위 국가 (원하면 수정)
  const countries = (req.nextUrl.searchParams.get("countries") || "KR,US,JP,GB,DE")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

  for (const c of countries) {
    // 원문 → 토큰 줄인 것 2가지 정도만 시도
    for (const term of [base, base.split(" ").slice(0, 6).join(" ")]) {
      const hit = await search(term, c);
      if (hit) return NextResponse.json({ ok: true, source: "itunes", ...hit });
    }
  }
  return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
}
