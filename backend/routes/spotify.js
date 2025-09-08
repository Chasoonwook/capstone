// routes/spotify.js
console.log("[spotify] router loaded v3");

const express = require("express");
const router = express.Router();

// Node 18+ 에서 global.fetch 사용
const fetch = global.fetch;

// 必: 환경변수
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// 앱 토큰(검색/커버에만 사용) 캐시
let appToken = null;
let appTokenExp = 0;

async function getAppToken() {
  const now = Date.now();
  if (appToken && now < appTokenExp - 5000) return appToken;

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" });

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
}

router.get("/__ping", (_req, res) => {
  res.json({ ok: true, from: "routes/spotify.js" });
});

/**
 * GET /api/spotify/search?query=...&limit=1&market=KR
 *  - 프런트에서 앨범커버 hydrate 용으로 사용
 *  - 결과 형식: { items: [{ id, name, album: { images:[...] } }], total }
 */
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.query || req.query.q || "").trim();
    const limit = Math.max(1, Math.min(10, Number(req.query.limit || 1)));
    const market = String(req.query.market || "KR");
    if (!q) return res.status(400).json({ error: "missing query" });

    const token = await getAppToken();
    const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
      type: "track",
      q,
      limit: String(limit),
      market,
    }).toString()}`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    if (!r.ok) {
      console.error("[spotify/search] error:", r.status, json);
      return res.status(r.status).json({ error: "spotify search failed" });
    }

    const items = (json?.tracks?.items || []).map((t) => ({
      id: t.id,
      name: t.name,
      album: { id: t.album?.id, name: t.album?.name, images: t.album?.images || [] },
    }));
    res.json({ items, total: json?.tracks?.total || items.length });
  } catch (e) {
    console.error("[spotify/search] exception:", e);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
