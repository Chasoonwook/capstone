// src/app/api/spotify/token/route.ts
import { NextResponse } from "next/server";

/** ---------- 타입 ---------- */
type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

let cached: { access_token: string; expires_at: number } | null = null;

/** ---------- 내부 함수 ---------- */
async function fetchNewToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!id || !secret) {
    throw new Error("Spotify client id/secret missing in env");
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`spotify_token_fetch_failed_${res.status}:${txt}`);
  }

  const json = (await res.json()) as SpotifyTokenResponse;
  // 1분 여유를 두고 만료 처리
  cached = {
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  };
  return cached.access_token;
}

async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expires_at) {
    return cached.access_token;
  }
  return fetchNewToken();
}

/** ---------- 핸들러 ---------- */
export async function GET() {
  try {
    const token = await getToken();
    return NextResponse.json({ access_token: token });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
