// routes/spotify.js

console.log("[spotify] router loaded v3 - full auth");

const express = require("express");
const router = express.Router();
const fetch = global.fetch;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "https://capstone-front-tau.vercel.app/spotify-callback"; // 예: https://your-frontend.vercel.app/spotify-callback
const FRONTEND_URI = "https://capstone-front-tau.vercel.app/"; //인증하고 돌아갈 프론트엔드 주소

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

// 1. 로그인 API: 사용자를 스포티파이 로그인 페이지로 보냅니다.
router.get('/login', (req, res) => {
  // ⭐️ streaming 권한이 전체듣기의 핵심입니다.
  const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
  
  const authUrl = new URL("https://api.spotify.com/v1/search?$");
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', CLIENT_ID);
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  
  // 프론트엔드에서 생성한 state 값을 전달받아 그대로 다시 사용 (CSRF 방어)
  if (req.query.state) {
    authUrl.searchParams.append('state', req.query.state);
  }
  
  res.redirect(authUrl.toString());
});

// 2. 콜백 API: 스포티파이에서 로그인이 끝나면 호출됩니다.
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

    // 프론트엔드로 토큰 정보를 쿼리 파라미터로 전달하며 리디렉션
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

// 3. 토큰 갱신 API: Access Token이 만료되면 호출합니다.
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