// routes/spotify.js
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const router = express.Router();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI; // ex) https://capstone-app-back.onrender.com/api/spotify/callback
const FRONT_BASE  = process.env.FRONT_BASE || "https://capstone-front-tau.vercel.app";

const CK_ACCESS  = "sp_access";
const CK_REFRESH = "sp_refresh";

const SCOPE = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

// ─────────────── helpers ───────────────
const b64url = (buf) => buf.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const makeVerifier = () => b64url(crypto.randomBytes(32));
const makeChallenge = (v) => b64url(crypto.createHash("sha256").update(v).digest());

function getAccessFromCookie(req, res) {
  const t = req.cookies?.[CK_ACCESS];
  if (!t) {
    res.status(401).json({ error: "NO_ACCESS_TOKEN" });
    return null;
  }
  return t;
}

// ─────────────── sanity check ───────────────
router.get("/ping", (_req, res) => res.json({ ok: true, route: "/api/spotify/ping" }));

// ─────────────── authorize ───────────────
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

// ─────────────── callback ───────────────
router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("No code");

    let returnTo = "/";
    try {
      if (state) {
        const parsed = JSON.parse(Buffer.from(String(state), "base64url").toString("utf8"));
        if (parsed?.r) returnTo = parsed.r;
      }
    } catch {}

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
    const common = { httpOnly: true, secure: true, sameSite: "none", path: "/" };

    res.cookie(CK_ACCESS, access_token, { ...common, maxAge: (expires_in || 3600) * 1000 });
    if (refresh_token) {
      res.cookie(CK_REFRESH, refresh_token, { ...common, maxAge: 30 * 24 * 3600 * 1000 });
    }
    res.clearCookie("sp_pkce", { path: "/" });

    res.redirect(`${FRONT_BASE}${returnTo}${returnTo.includes("?") ? "&" : "?"}spotify=connected`);
  } catch (err) {
    console.error("[spotify/callback]", err.response?.data || err.message);
    res.status(500).send("Spotify authentication failed");
  }
});

// ─────────────── refresh ───────────────
router.get("/refresh", async (req, res) => {
  try {
    const refresh = req.cookies?.[CK_REFRESH];
    if (!refresh) return res.status(401).json({ error: "NO_REFRESH_TOKEN" });

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: String(CLIENT_ID),
      client_secret: String(CLIENT_SECRET),
    });

    const tokenRes = await axios.post("https://accounts.spotify.com/api/token", body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const { access_token, expires_in } = tokenRes.data || {};
    res.cookie(CK_ACCESS, access_token, {
      httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: (expires_in || 3600) * 1000,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[spotify/refresh]", err.response?.data || err.message);
    res.status(500).json({ error: "REFRESH_FAILED" });
  }
});

// ─────────────── me ───────────────
router.get("/me", async (req, res) => {
  try {
    const access = getAccessFromCookie(req, res); if (!access) return;

    const r = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json(r.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: "SPOTIFY_ME_FAILED" });
  }
});

/* =====================================================
   🎵 Web Playback SDK / Spotify Connect 보조 엔드포인트
   ===================================================== */

// SDK 초기화용: 현재 access token 반환
router.get("/token", (req, res) => {
  const access = req.cookies?.[CK_ACCESS];
  if (!access) return res.status(401).json({ error: "NO_ACCESS_TOKEN" });
  res.json({ access_token: access });
});

// 연결된 디바이스 조회
router.get("/devices", async (req, res) => {
  const access = getAccessFromCookie(req, res); if (!access) return;
  try {
    const r = await axios.get("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json(r.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: "DEVICES_FAILED" });
  }
});

// 이 웹 플레이어로 전환
router.put("/transfer", async (req, res) => {
  const access = getAccessFromCookie(req, res); if (!access) return;
  const { device_id, play } = req.body || {};
  if (!device_id) return res.status(400).json({ error: "MISSING_DEVICE_ID" });
  try {
    await axios.put("https://api.spotify.com/v1/me/player",
      { device_ids: [device_id], play: !!play },
      { headers: { Authorization: `Bearer ${access}` } }
    );
    res.json({ ok: true });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: "TRANSFER_FAILED" });
  }
});

// 재생 시작 (uris or context_uri)
router.put("/play", async (req, res) => {
  const access = getAccessFromCookie(req, res); if (!access) return;

  const { device_id, uris, context_uri, offset, position_ms } = req.body || {};
  try {
    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (device_id) url.searchParams.set("device_id", String(device_id));

    const payload = {};
    if (Array.isArray(uris) && uris.length) payload.uris = uris;
    if (context_uri) payload.context_uri = context_uri;
    if (offset) payload.offset = offset;
    if (typeof position_ms === "number") payload.position_ms = position_ms;

    await axios.put(url.toString(), payload, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: "PLAY_FAILED" });
  }
});

// 일시정지
router.put("/pause", async (req, res) => {
  const access = getAccessFromCookie(req, res); if (!access) return;
  try {
    await axios.put("https://api.spotify.com/v1/me/player/pause", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: "PAUSE_FAILED" });
  }
});

// 다음/이전 트랙
router.post("/next", async (req, res) => {
  const access = getAccessFromCookie(req, res); if (!access) return;
  try {
    await axios.post("https://api.spotify.com/v1/me/player/next", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: "NEXT_FAILED" });
  }
});

router.post("/previous", async (req, res) => {
  const access = getAccessFromCookie(req, res); if (!access) return;
  try {
    await axios.post("https://api.spotify.com/v1/me/player/previous", {}, {
      headers: { Authorization: `Bearer ${access}` },
    });
    res.json({ ok: true });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json(err.response?.data || { error: "PREV_FAILED" });
  }
});

module.exports = router;
