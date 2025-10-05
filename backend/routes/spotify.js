// routes/spotify.js

console.log("[spotify] router loaded v3 - simplified");

const express = require("express");
const router = express.Router();
const fetch = global.fetch;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// 앱 토큰(검색용) 캐시
let appToken = null;
let appTokenExp = 0;

async function getAppToken() {
  const now = Date.now();
  if (appToken && now < appTokenExp - 5000) return appToken;

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" });

  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await r.json();
    if (!r.ok) {
      console.error("[spotify] app token error:", r.status, json);
      throw new Error(`spotify token ${r.status}`);
    }
    appToken = json.access_token;
    appTokenExp = now + (json.expires_in || 3600) * 1000;
    return appToken;
  } catch (error) {
    console.error("[spotify] Failed to get app token:", error);
    throw error;
  }
}

/**
 * GET /api/spotify/search?query=...
 * - 앱 토큰을 사용한 공개 정보 검색 API
 */
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.query || req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "missing query" });
    
    const token = await getAppToken();
    const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
      type: "track",
      q,
      limit: "5", // 필요 시 limit 조절
      market: "KR",
    }).toString()}`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    if (!r.ok) {
      console.error("[spotify/search] error:", r.status, json);
      return res.status(r.status).json({ error: "spotify search failed" });
    }
    
    // 프론트엔드가 필요한 정보만 간단히 가공하여 전달
    const items = (json?.tracks?.items || []).map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      image: t.album?.images?.[0]?.url || null,
      uri: t.uri
    }));
    
    res.json({ items });
  } catch (e) {
    console.error("[spotify/search] exception:", e);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;