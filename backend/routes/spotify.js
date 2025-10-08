const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const router = express.Router();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;
const FRONT_BASE = process.env.FRONT_BASE || "https://capstone-front-tau.vercel.app";

const SCOPE = [
  "streaming", "user-read-email", "user-read-private",
  "user-read-playback-state", "user-modify-playback-state",
].join(" ");

// 헬퍼 함수
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const makeVerifier = () => b64url(crypto.randomBytes(32));
const makeChallenge = (v) => b64url(crypto.createHash("sha256").update(v).digest());

// ▼▼▼▼▼ [수정됨] 인증 토큰 추출 헬퍼 ▼▼▼▼▼
function getAccessToken(req, res) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    res.status(401).json({ error: "NO_ACCESS_TOKEN" });
    return null;
}
// ▲▲▲▲▲ [수정됨] 여기까지 ▲▲▲▲▲

// 인증 시작
router.get("/authorize", (req, res) => {
  const returnTo = req.query.return || "/";
  const state = b64url(Buffer.from(JSON.stringify({ r: returnTo })));

  const verifier = makeVerifier();
  const challenge = makeChallenge(verifier);
  res.cookie("sp_pkce", verifier, {
    httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 5 * 60 * 1000,
  });

  const p = new URLSearchParams({
    client_id: String(CLIENT_ID),
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${p.toString()}`);
});

// 인증 콜백
router.get("/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code");

    const verifier = req.cookies?.sp_pkce;
    if (!verifier) return res.status(400).send("Missing PKCE verifier");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: REDIRECT_URI,
      client_id: String(CLIENT_ID),
      code_verifier: verifier,
    });

    const tokenRes = await axios.post("https://accounts.spotify.com/api/token", body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data || {};
    res.clearCookie("sp_pkce", { path: "/" });

    // 프론트엔드의 콜백 페이지로 토큰 정보를 넘겨줌
    const params = new URLSearchParams({ access_token, expires_in: String(expires_in) });
    if (refresh_token) params.set("refresh_token", refresh_token);

    res.redirect(`${FRONT_BASE}/spotify-callback?${params.toString()}`);
  } catch (err) {
    res.status(500).send("Spotify authentication failed");
  }
});

// 토큰 갱신
router.post("/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: "NO_REFRESH_TOKEN" });

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id: String(CLIENT_ID),
      client_secret: String(CLIENT_SECRET),
    });

    const tokenRes = await axios.post("https://accounts.spotify.com/api/token", body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    res.json({ ok: true, ...tokenRes.data });
  } catch (err) {
    res.status(500).json({ error: "REFRESH_FAILED" });
  }
});

// ▼▼▼▼▼ [수정됨] 모든 API 엔드포인트가 getAccessToken 사용 ▼▼▼▼▼

// 사용자 정보
router.get("/me", async (req, res) => {
  const access = getAccessToken(req, res); if (!access) return;
  try {
    const r = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json(r.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

// 재생 기기 목록
router.get("/devices", async (req, res) => {
  const access = getAccessToken(req, res); if (!access) return;
  try {
    const r = await axios.get("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json(r.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

// 재생 기기 변경
router.put("/transfer", async (req, res) => {
  const access = getAccessToken(req, res); if (!access) return;
  const { device_id, play } = req.body || {};
  if (!device_id) return res.status(400).json({ error: "MISSING_DEVICE_ID" });
  try {
    await axios.put("https://api.spotify.com/v1/me/player",
      { device_ids: [device_id], play: !!play },
      { headers: { Authorization: `Bearer ${access}` } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

// 재생/재개
router.put("/play", async (req, res) => {
  const access = getAccessToken(req, res); if (!access) return;
  const { device_id } = req.body || {};
  try {
    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (device_id) url.searchParams.set("device_id", String(device_id));

    await axios.put(url.toString(), req.body, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

// 일시정지
router.put("/pause", async (req, res) => {
  const access = getAccessToken(req, res); if (!access) return;
  try {
    await axios.put("https://api.spotify.com/v1/me/player/pause", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

// 다음/이전 곡
router.post("/next", async (req, res) => {
  const access = getAccessToken(req, res); if (!access) return;
  try {
    await axios.post("https://api.spotify.com/v1/me/player/next", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

router.post("/previous", async (req, res) => {
  const access = getAccessToken(req, res); if (!access) return;
  try {
    await axios.post("https://api.spotify.com/v1/me/player/previous", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});


module.exports = router;