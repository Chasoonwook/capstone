// src/app/api/spotify/token/route.ts
import { NextResponse } from "next/server";
import {
  getAccessCookie,
  getRefreshCookie,
  setAccessCookie,
  refreshSpotifyToken,
} from "@/lib/spotify";

// (옵션) Node 런타임 고정이 필요하면 주석 해제
// export const runtime = "nodejs";

export async function GET() {
  try {
    // 1) 쿠키에서 access 먼저 시도
    const access = await getAccessCookie();
    if (access) {
      return NextResponse.json({ access_token: access });
    }

    // 2) 없으면 refresh로 재발급
    const refresh = await getRefreshCookie();
    if (!refresh) {
      return NextResponse.json(
        { error: "No refresh token cookie" },
        { status: 401 },
      );
    }

    const refreshed = await refreshSpotifyToken(refresh);
    // 액세스 쿠키 저장
    await setAccessCookie(refreshed.access_token, refreshed.expires_in);

    return NextResponse.json({
      access_token: refreshed.access_token,
      expires_in: refreshed.expires_in,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Token endpoint failed", detail: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
