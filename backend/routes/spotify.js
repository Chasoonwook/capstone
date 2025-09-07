// Backend/routes/spotify.js
const express = require("express");

const router = require("express").Router();

// 메모리 캐시 (Client Credentials 토큰)
let appToken = {
  access_token: null,
  expires_at: 0, // epoch ms
};

async function getAppAccessToken() {
  const now = Date.now();
  if (appToken.access_token && appToken.expires_at - 60_000 > now) {
    return appToken.access_token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[spotify] env missing", { hasId: !!clientId, hasSecret: !!clientSecret });
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET missing");
  }

  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("[spotify] token error", resp.status, json); // ← 원인 표시
    throw new Error(`token_failed:${resp.status}:${json.error || "unknown"}`);
  }

  appToken = {
    access_token: json.access_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  return appToken.access_token;
}



/**
 * GET /api/spotify/search?query=아이유 밤편지&limit=10
 * 클라이언트에서 안전하게 호출 가능(백엔드가 토큰을 숨겨줌)
 * 반환: 필요한 필드만 슬림하게 변환
 */
router.get("/search", async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    const limit = Number(req.query.limit || 10);

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const token = await getAppAccessToken();

    const url = new URL("https://api.spotify.com/v1/search");
    url.searchParams.set("q", query);
    url.searchParams.set("type", "track");
    url.searchParams.set("limit", String(limit));

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();

    if (!r.ok) {
      console.error("Spotify search error:", data);
      return res
        .status(400)
        .json({ error: "spotify search failed", details: data });
    }

    // 필요한 필드만 추려서 프론트로 전달 (커버/제목/아티스트/길이/미리듣기/링크)
    const items =
      data?.tracks?.items?.map((t) => ({
        id: t.id,
        name: t.name,
        artists: t.artists?.map((a) => a.name) ?? [],
        album: {
          id: t.album?.id,
          name: t.album?.name,
          images: t.album?.images ?? [], // [{url,height,width}...]
        },
        duration_ms: t.duration_ms,
        preview_url: t.preview_url, // 30초 미리듣기(있을 수도/없을 수도)
        external_url: t.external_urls?.spotify ?? null,
        uri: t.uri, // "spotify:track:..."
      })) ?? [];

    return res.json({ items, total: data?.tracks?.total ?? 0 });
  } catch (err) {
    console.error("[spotify/search] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "internal error", detail });
    }

});

module.exports = router;
