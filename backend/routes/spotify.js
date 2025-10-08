// routes/spotify.js
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const router = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI; // ex) https://capstone-app-back.onrender.com/api/spotify/callback
const FRONT_BASE    = process.env.FRONT_BASE || "https://capstone-front-tau.vercel.app";

const CK_ACCESS  = "sp_access";
const CK_REFRESH = "sp_refresh";

// Spotify 권한 스코프
const SCOPE = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

// Base64URL 유틸
const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

// ───────────────────────────────────────────────────────────
// 쿠키 유틸
function setAccessCookie(res, token, expiresInSec) {
  res.cookie(CK_ACCESS, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: Math.max(1, Number(expiresInSec || 3600)) * 1000,
  });
}
function setRefreshCookie(res, token, days = 30) {
  res.cookie(CK_REFRESH, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: days * 24 * 3600 * 1000,
  });
}
function clearSpotifyCookies(res) {
  const opt = { httpOnly: true, secure: true, sameSite: "none", path: "/" };
  res.clearCookie(CK_ACCESS, opt);
  res.clearCookie(CK_REFRESH, opt);
}

// ───────────────────────────────────────────────────────────
// 1) 로그인 시작 (기존 /authorize 도 유지 호환)
router.get(["/login", "/authorize"], async (req, res) => {
  try {
    const returnTo = req.query.return || "/"; // 필요 시 UI에서 사용
    const state = b64url(Buffer.from(JSON.stringify({ r: returnTo })));

    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(
      crypto.createHash("sha256").update(verifier).digest()
    );

    // PKCE verifier는 짧게 보관(민감 토큰 아님)
    res.cookie("sp_pkce", verifier, {
      httpOnly: false,
      secure: true,
      sameSite: "none",
      path: "/api/spotify",
      maxAge: 10 * 60 * 1000,
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

    return res.redirect(`https://accounts.spotify.com/authorize?${p.toString()}`);
  } catch (e) {
    console.error("[spotify/login] error:", e);
    return res.status(500).json({ error: "login_init_failed" });
  }
});

// 2) 콜백: code → access/refresh 교환 후 **HttpOnly 쿠키로 저장**
router.get("/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code");

    const verifier = req.cookies?.sp_pkce;
    if (!verifier) return res.status(400).send("Missing PKCE verifier");

    // 한 번 쓰고 제거
    res.clearCookie("sp_pkce", { secure: true, sameSite: "none", path: "/api/spotify" });

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: REDIRECT_URI,
      client_id: String(CLIENT_ID),
      code_verifier: verifier,
    });

    const tokenRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      body.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data || {};
    setAccessCookie(res, access_token, expires_in);
    if (refresh_token) setRefreshCookie(res, refresh_token);

    // 프론트 안내 페이지로 (토큰을 쿼리/로컬스토리지로 넘기지 않음)
    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=1`);
  } catch (err) {
    console.error("[spotify/callback] error:", err?.response?.data || err.message);
    clearSpotifyCookies(res);
    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=0`);
  }
});

// 내부 util: refresh_token → 새 access_token
async function refreshAccessToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      // note: CLIENT_SECRET 방식/PKCE 혼용 시 auth 헤더 방식으로도 가능
      client_id: String(CLIENT_ID),
      client_secret: String(CLIENT_SECRET),
    });
    const resp = await axios.post(
      "https://accounts.spotify.com/api/token",
      body.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return resp.data; // { access_token, expires_in, ... }
  } catch (e) {
    console.error("[spotify] refreshAccessToken error:", e?.response?.data || e.message);
    return null;
  }
}

// 3) 상태 조회: 쿠키에 든 토큰으로 /v1/me 호출 (필수: 프론트 fetch는 credentials: 'include')
router.get("/me", async (req, res) => {
  try {
    const access = req.cookies?.[CK_ACCESS];
    const refresh = req.cookies?.[CK_REFRESH];
    if (!access && !refresh) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const getMe = async (token) =>
      axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

    try {
      const r = await getMe(access);
      return res.json({ connected: true, profile: r.data });
    } catch (e) {
      if (!refresh) return res.status(401).json({ error: "token_expired" });
      const refreshed = await refreshAccessToken(refresh);
      if (!refreshed?.access_token) {
        clearSpotifyCookies(res);
        return res.status(401).json({ error: "refresh_failed" });
      }
      setAccessCookie(res, refreshed.access_token, refreshed.expires_in);

      const r2 = await getMe(refreshed.access_token);
      return res.json({ connected: true, profile: r2.data, refreshed: true });
    }
  } catch (e) {
    console.error("[spotify/me] error:", e?.response?.data || e.message);
    return res.status(500).json({ error: "me_failed" });
  }
});

// 4) 수동 리프레시(옵션) — 쿠키에서 refresh 가져와 재발급
router.post("/refresh", async (req, res) => {
  try {
    const refresh = req.cookies?.[CK_REFRESH];
    if (!refresh) return res.status(401).json({ error: "no_refresh" });
    const data = await refreshAccessToken(refresh);
    if (!data?.access_token) return res.status(401).json({ error: "refresh_failed" });
    setAccessCookie(res, data.access_token, data.expires_in);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[spotify/refresh] error:", e?.response?.data || e.message);
    return res.status(500).json({ error: "refresh_error" });
  }
});

// 5) 재생 관련 API: 모두 **쿠키의 access** 사용
function requireAccessFromCookie(req, res) {
  const token = req.cookies?.[CK_ACCESS];
  if (!token) {
    return null;
  }
  return token;
}

router.get("/devices", async (req, res) => {
  const access = requireAccessFromCookie(req, res);
  if (!access) return res.status(401).json({ error: "unauthorized" });
  try {
    const r = await axios.get("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json(r.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

router.put("/transfer", async (req, res) => {
  const access = requireAccessFromCookie(req, res);
  if (!access) return res.status(401).json({ error: "unauthorized" });
  const { device_id, play } = req.body || {};
  if (!device_id) return res.status(400).json({ error: "MISSING_DEVICE_ID" });
  try {
    await axios.put(
      "https://api.spotify.com/v1/me/player",
      { device_ids: [device_id], play: !!play },
      { headers: { Authorization: `Bearer ${access}` } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

router.put("/play", async (req, res) => {
  const access = requireAccessFromCookie(req, res);
  if (!access) return res.status(401).json({ error: "unauthorized" });
  try {
    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (req.body?.device_id) url.searchParams.set("device_id", String(req.body.device_id));
    await axios.put(url.toString(), req.body, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

router.put("/pause", async (req, res) => {
  const access = requireAccessFromCookie(req, res);
  if (!access) return res.status(401).json({ error: "unauthorized" });
  try {
    await axios.put("https://api.spotify.com/v1/me/player/pause", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

router.post("/next", async (req, res) => {
  const access = requireAccessFromCookie(req, res);
  if (!access) return res.status(401).json({ error: "unauthorized" });
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
  const access = requireAccessFromCookie(req, res);
  if (!access) return res.status(401).json({ error: "unauthorized" });
  try {
    await axios.post("https://api.spotify.com/v1/me/player/previous", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || {});
  }
});

// 6) 로그아웃(연결 해제)
router.post("/logout", (req, res) => {
  clearSpotifyCookies(res);
  return res.json({ ok: true });
});

module.exports = router;
