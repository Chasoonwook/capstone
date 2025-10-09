// routes/spotify.js
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const router = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI; // e.g. https://capstone-app-back.onrender.com/api/spotify/callback
const FRONT_BASE    = process.env.FRONT_BASE || "https://capstone-front-tau.vercel.app";

const CK_ACCESS  = "sp_access";
const CK_REFRESH = "sp_refresh";

const SCOPE = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

// ── utils
const b64url = (bufOrStr) =>
  Buffer.from(bufOrStr).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");

const b64urlToStr = (s="") => {
  const base64 = String(s).replace(/-/g,"+").replace(/_/g,"/");
  const pad = base64.length % 4 ? 4 - (base64.length % 4) : 0;
  return Buffer.from(base64 + "=".repeat(pad), "base64").toString("utf8");
};

const safeReturnTo = (val) => (typeof val === "string" && /^\/(?!\/)/.test(val) ? val : "/");

function setAccessCookie(res, token, expiresInSec) {
  if (!token) return;
  res.cookie(CK_ACCESS, token, {
    httpOnly: true, secure: true, sameSite: "none", path: "/",
    maxAge: Math.max(1, Number(expiresInSec || 3600)) * 1000,
  });
}
function setRefreshCookie(res, token, days = 30) {
  if (!token) return;
  res.cookie(CK_REFRESH, token, {
    httpOnly: true, secure: true, sameSite: "none", path: "/",
    maxAge: days * 24 * 3600 * 1000,
  });
}
function clearSpotifyCookies(res) {
  const opt = { httpOnly: true, secure: true, sameSite: "none", path: "/" };
  res.clearCookie(CK_ACCESS, opt);
  res.clearCookie(CK_REFRESH, opt);
}

async function refreshAccessToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: String(CLIENT_ID),
      client_secret: String(CLIENT_SECRET),
    });
    const r = await axios.post("https://accounts.spotify.com/api/token", body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return r.data; // { access_token, expires_in, ... }
  } catch (e) {
    console.error("[spotify] refreshAccessToken:", e?.response?.data || e.message);
    return null;
  }
}

// ★ 공통: 쿠키에서 access로 호출, 실패 시 refresh로 갱신해서 재시도
async function callSpotifyWithCookies(req, res, method, url, data, params) {
  let access = req.cookies?.[CK_ACCESS] || null;
  const refresh = req.cookies?.[CK_REFRESH] || null;

  const doCall = (token) =>
    axios.request({
      method, url, data, params,
      headers: { Authorization: `Bearer ${token}` },
    });

  try {
    if (!access) throw new Error("NO_ACCESS");
    const r = await doCall(access);
    return r;
  } catch (e1) {
    // 401/403만 refresh 시도
    const status = e1?.response?.status;
    if (!refresh || (status !== 401 && status !== 403)) throw e1;

    const ref = await refreshAccessToken(refresh);
    if (!ref?.access_token) throw e1;

    setAccessCookie(res, ref.access_token, ref.expires_in);
    const r2 = await doCall(ref.access_token);
    return r2;
  }
}

// ───────────────────────────────────────────────────────────
// 로그인 시작
router.get(["/login", "/authorize"], (req, res) => {
  const returnTo = safeReturnTo(req.query.return);          // ★
  const state = b64url(JSON.stringify({ r: returnTo }));    // ★

  const verifier  = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

  res.cookie("sp_pkce", verifier, {
    httpOnly: false, secure: true, sameSite: "none", path: "/api/spotify", maxAge: 10 * 60 * 1000,
  });

  const p = new URLSearchParams({
    client_id: String(CLIENT_ID),
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,                                  // ★
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${p.toString()}`);
});

// 콜백
router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("No code");
    const verifier = req.cookies?.sp_pkce;
    if (!verifier) return res.status(400).send("Missing PKCE verifier");

    let returnTo = "/";
    if (state) {
      try { const j = JSON.parse(b64urlToStr(state)); returnTo = safeReturnTo(j?.r); } catch {}
    }
    res.clearCookie("sp_pkce", { secure: true, sameSite: "none", path: "/api/spotify" });

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
    setAccessCookie(res, access_token, expires_in);
    if (refresh_token) setRefreshCookie(res, refresh_token);

    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=1&r=${encodeURIComponent(returnTo)}`); // ★
  } catch (err) {
    console.error("[spotify/callback]", err?.response?.data || err.message);
    clearSpotifyCookies(res);
    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=0&r=${encodeURIComponent("/")}`); // ★
  }
});

// 상태
router.get("/me", async (req, res) => {
  try {
    const r = await callSpotifyWithCookies(req, res, "GET", "https://api.spotify.com/v1/me");
    return res.json({ connected: true, profile: r.data });
  } catch (e) {
    const s = e?.response?.status || 500;
    if (s === 401) return res.status(401).json({ error: "unauthorized" });
    return res.status(s).json(e?.response?.data || { error: "me_failed" });
  }
});

// 재생 관련
router.get("/devices", async (req, res) => {
  try {
    const r = await callSpotifyWithCookies(req, res, "GET", "https://api.spotify.com/v1/me/player/devices");
    res.json(r.data);
  } catch (e) {
    res.status(e?.response?.status || 500).json(e?.response?.data || {});
  }
});
router.put("/transfer", async (req, res) => {
  try {
    await callSpotifyWithCookies(req, res, "PUT", "https://api.spotify.com/v1/me/player",
      { device_ids: [req.body?.device_id], play: !!req.body?.play });
    res.json({ ok: true });
  } catch (e) {
    res.status(e?.response?.status || 500).json(e?.response?.data || {});
  }
});
router.put("/play", async (req, res) => {
  try {
    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (req.body?.device_id) url.searchParams.set("device_id", String(req.body.device_id));
    await callSpotifyWithCookies(req, res, "PUT", url.toString(), req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(e?.response?.status || 500).json(e?.response?.data || {});
  }
});
router.put("/pause", async (req, res) => {
  try {
    await callSpotifyWithCookies(req, res, "PUT", "https://api.spotify.com/v1/me/player/pause", {});
    res.json({ ok: true });
  } catch (e) {
    res.status(e?.response?.status || 500).json(e?.response?.data || {});
  }
});
router.post("/next", async (req, res) => {
  try {
    await callSpotifyWithCookies(req, res, "POST", "https://api.spotify.com/v1/me/player/next", {});
    res.json({ ok: true });
  } catch (e) {
    res.status(e?.response?.status || 500).json(e?.response?.data || {});
  }
});
router.post("/previous", async (req, res) => {
  try {
    await callSpotifyWithCookies(req, res, "POST", "https://api.spotify.com/v1/me/player/previous", {});
    res.json({ ok: true });
  } catch (e) {
    res.status(e?.response?.status || 500).json(e?.response?.data || {});
  }
});

// ★ 추가: 검색 API (프론트 util에서 사용)
//    GET /api/spotify/search?q=TITLE ARTIST&type=track&limit=1
router.get("/search", async (req, res) => {
  try {
    const q = req.query.q || req.query.query; // 둘 다 허용
    const type = String(req.query.type || "track");
    const limit = Number(req.query.limit || 5);
    if (!q) return res.status(400).json({ error: "missing_q" });

    const r = await callSpotifyWithCookies(
      req, res, "GET", "https://api.spotify.com/v1/search", null,
      { q: String(q), type, limit }
    );
    res.json(r.data);
  } catch (e) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { error: "search_failed" });
  }
});

// 연결 해제
router.post("/logout", (req, res) => {
  clearSpotifyCookies(res);
  res.json({ ok: true });
});

module.exports = router;
