// routes/spotify.js

console.log("[spotify] router loaded v3 - full auth");

const express = require("express");
const router = express.Router();
const fetch = global.fetch;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// ✅ [수정] 스포티파이가 인증 코드를 돌려줄 주소는 바로 이 백엔드 서버의 callback 주소여야 합니다.
const REDIRECT_URI = "https://capstone-app-back.onrender.com/api/spotify/callback"; 

// ✅ 인증이 모두 끝난 후 최종적으로 돌아갈 프론트엔드 주소입니다. (이것은 올바르게 설정되어 있습니다)
const FRONTEND_URI = "https://capstone-front-tau.vercel.app/";

// --- 이하 코드는 수정할 필요 없습니다 ---

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

router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.query || req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "missing query" });
    
    const token = await getAppToken();
    const url = `https://api.spotify.com/v1/search?$${new URLSearchParams({
      type: "track",
      q,
      limit: "5",
      market: "KR",
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

router.get('/login', (req, res) => {
  const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
  
  const authUrl = new URL("https://api.spotify.com/v1/search?$");
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', CLIENT_ID);
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  
  if (req.query.state) {
    authUrl.searchParams.append('state', req.query.state);
  }
  
  res.redirect(authUrl.toString());
});

router.get('/callback', async (req, res) => {
  const code = req.query.code || null;

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
  });

  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || 'Failed to fetch token');
    }

    const { access_token, refresh_token, expires_in } = data;

    const queryParams = new URLSearchParams({
      access_token,
      refresh_token,
      expires_in,
    });
    res.redirect(`${FRONTEND_URI}/spotify-callback?${queryParams.toString()}`);

  } catch (error) {
    console.error('[spotify/callback] error:', error);
    res.redirect(`${FRONTEND_URI}/spotify-callback?error=token_exchange_failed`);
  }
});

router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh_token,
  });

  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || 'Failed to refresh token');
    }

    res.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (error) {
    console.error('[spotify/refresh] error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;