// src/app/api/spotify/search/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// ----- 앱 토큰(클라이언트 자격증명) 캐시 -----
type AppTok = { accessToken: string; expiresAt: number };
const g = globalThis as unknown as { __spAppTok?: AppTok };

async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (g.__spAppTok && g.__spAppTok.expiresAt - 10_000 > now) {
    return g.__spAppTok.accessToken;
  }
  const id = process.env.SPOTIFY_CLIENT_ID!;
  const secret = process.env.SPOTIFY_CLIENT_SECRET!;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!r.ok) throw new Error("spotify_app_token_fail");
  const js = (await r.json()) as any;
  g.__spAppTok = {
    accessToken: js.access_token,
    expiresAt: Date.now() + (js.expires_in ?? 3600) * 1000,
  };
  return g.__spAppTok.accessToken;
}

// ----- 유틸 -----
const pickImage = (x: any) =>
  x?.album?.images?.[1]?.url || x?.album?.images?.[0]?.url || x?.album?.images?.[2]?.url || null;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("query")?.trim();
  // 콤마로 여러 마켓 전달 가능: KR,US,JP,GB …
  const marketsParam = req.nextUrl.searchParams.get("markets") || "KR,US,JP,GB";
  // 한 마켓에서 여러 후보를 보려면 limit을 5 정도로
  const limit = Math.max(1, Math.min(5, Number(req.nextUrl.searchParams.get("limit") ?? "5")));
  if (!q) return NextResponse.json({ ok: false, reason: "missing_query" }, { status: 400 });

  try {
    const token = await getAppToken();
    const markets = marketsParam
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);

    // 1) 마켓을 바꿔가며 검색
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

      const js = (await r.json()) as any;
      const items: any[] = js?.tracks?.items ?? [];
      if (!items.length) continue;

      // 1-1) 같은 마켓 내에서 preview_url 있는 후보 먼저 선택
      const withPreview = items.find((t) => !!t?.preview_url);
      const chosen = withPreview || items[0];

      return NextResponse.json({
        ok: true,
        market,
        id: chosen?.id ?? null,
        name: chosen?.name ?? null,
        uri: chosen?.uri ?? null,
        preview_url: chosen?.preview_url ?? null,
        image: pickImage(chosen),
        // 참고용으로 상위 후보들도 반환
        items: items.map((x) => ({
          id: x?.id,
          name: x?.name,
          uri: x?.uri,
          preview_url: x?.preview_url,
          image: pickImage(x),
          artists: Array.isArray(x?.artists) ? x.artists.map((a: any) => a.name) : [],
        })),
        total: js?.tracks?.total ?? items.length,
      });
    }

    // 모든 마켓에서 못 찾음
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
