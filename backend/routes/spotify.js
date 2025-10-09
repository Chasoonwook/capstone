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

// base64url <-> string
const b64url = (bufOrStr) =>
  Buffer.from(bufOrStr)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const b64urlToStr = (s = "") => {
  const base64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 ? 4 - (base64.length % 4) : 0;
  return Buffer.from(base64 + "=".repeat(pad), "base64").toString("utf8");
};

// 안전한 return path만 허용 (오픈 리다이렉트 방지)
const safeReturnTo = (val) => (typeof val === "string" && /^\/(?!\/)/.test(val) ? val : "/");

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

// 내부 util: refresh_token → 새 access_token
async function refreshAccessToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
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

// ───────────────────────────────────────────────────────────
// 1) 로그인 시작 (로그인 버튼에서 이동)
//    ?return=/어느경로  → state에 안전하게 담아둠
router.get(["/login", "/authorize"], (req, res) => {
  const returnTo = safeReturnTo(req.query.return); // ★ RETURN: 눌렀던 화면 경로 받기
  const statePayload = { r: returnTo };           // ★ RETURN
  const state = b64url(JSON.stringify(statePayload)); // ★ RETURN

  // PKCE
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

  // 콜백 때 검증용
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
    state,                         // ★ RETURN: state로 전달
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  return res.redirect(`https://accounts.spotify.com/authorize?${p.toString()}`);
});

// 2) 콜백: code → token 교환, 쿠키 저장, 이후 프론트로 복귀
router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("No code");
    const verifier = req.cookies?.sp_pkce;
    if (!verifier) return res.status(400).send("Missing PKCE verifier");

    // state에서 returnTo 복원 (기본값 "/")
    let returnTo = "/";
    if (state) {
      try {
        const json = JSON.parse(b64urlToStr(state));
        returnTo = safeReturnTo(json?.r);
      } catch {}
    }

    // 일회용 쿠키 정리
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

    // 프론트 콜백 페이지로 이동, 최종 목적지도 함께 전달
    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=1&r=${encodeURIComponent(returnTo)}`); // ★ RETURN
  } catch (err) {
    console.error("[spotify/callback] error:", err?.response?.data || err.message);
    clearSpotifyCookies(res);
    // 실패 시에도 최소한 메인으로 돌려보냄
    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=0&r=${encodeURIComponent("/")}`); // ★ RETURN
  }
});

// 3) 상태 조회
router.get("/me", async (req, res) => {
  try {
    const access = req.cookies?.[CK_ACCESS];
    const refresh = req.cookies?.[CK_REFRESH];
    if (!access && !refresh) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const getMe = (token) =>
      axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

    try {
      const r = await getMe(access);
      return res.json({ connected: true, profile: r.data });
    } catch {
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

// 4) 수동 리프레시(옵션)
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

// 5) 재생 관련 API들 — 모두 쿠키의 access 사용
function requireAccessFromCookie(req, res) {
  const token = req.cookies?.[CK_ACCESS];
  return token || null;
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
    await axios.put(url.toString(), req.body, { headers: { Authorization: `Bearer ${access}` } });
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
