// routes/spotify.js
// Spotify Web Playback + REST 프록시 라우터 (커버/미리듣기/SDK 토큰 포함)

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const router = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI; // e.g. https://.../api/spotify/callback
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

// axios (업스트림 지연 방어)
const axiosSpotify = axios.create({ timeout: 10000 });

// /me 캐시
const meCache = new Map(); // key: accessToken, val: { ts, profile, pending? }
const ME_TTL_MS = 60 * 1000;

/* ─────────────── utils ─────────────── */
const b64url = (bufOrStr) =>
  Buffer.from(bufOrStr).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");

const b64urlToStr = (s="") => {
  const base64 = String(s).replace(/-/g,"+").replace(/_/g,"/");
  const pad = base64.length % 4 ? 4 - (base64.length % 4) : 0;
  return Buffer.from(base64 + "=".repeat(pad), "base64").toString("utf8");
};

const safeReturnTo = (val) => (typeof val === "string" && /^\/(?!\/)/.test(val) ? val : "/");

/** 공통: 액세스/리프레시 쿠키 쓰기/지우기 */
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

/** App용(Client Credentials) 토큰 */
async function getAppToken() {
  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      },
      timeout: 10000,
    }
  );
  return resp.data?.access_token || null;
}

/** 토큰 리프레시 */
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
      timeout: 10000,
    });
    return r.data; // { access_token, expires_in, ... }
  } catch (e) {
    console.error("[spotify] refreshAccessToken:", e?.response?.data || e.message);
    return null;
  }
}

/** 에러 투명화: axios 에러를 상태/바디 그대로 전달 */
function formatAxiosErr(e) {
  const status = e?.response?.status || 500;
  const data = e?.response?.data || { error: e.message || "unknown_error" };
  console.error("[spotify api error]", status, data);
  return { status, data };
}

/**
 * 공통 호출: 쿠키 access로 호출 → 401/403이면 refresh로 갱신 후 1회 재시도
 * 실패 시, 실제 Spotify의 status/data를 그대로 반환(throw)
 */
async function callSpotifyWithCookies(req, res, method, url, data, params) {
  let access = req.cookies?.[CK_ACCESS] || null;
  const refresh = req.cookies?.[CK_REFRESH] || null;

  const doCall = (token) =>
    axiosSpotify.request({
      method, url, data, params,
      headers: { Authorization: `Bearer ${token}` },
    });

  try {
    if (!access) throw new Error("NO_ACCESS");
    const r = await doCall(access);
    return r;
  } catch (e1) {
    const status = e1?.response?.status;
    if (!refresh || (status !== 401 && status !== 403)) {
      throw e1;
    }
    // refresh
    const ref = await refreshAccessToken(refresh);
    if (!ref?.access_token) throw e1;

    setAccessCookie(res, ref.access_token, ref.expires_in);
    const r2 = await doCall(ref.access_token);
    return r2;
  }
}

/* ─────────────── 디버그 & 상태 ─────────────── */

router.get("/__health", (req, res) => res.json({ ok: true }));

/** 라우터/환경/세션 상태 확인용 */
router.get("/__debug", (req, res) => {
  res.json({
    ok: true,
    mounted: true,
    env: {
      clientId: !!CLIENT_ID,
      clientSecret: !!CLIENT_SECRET,
      redirectUri: !!REDIRECT_URI,
    },
    cookies: {
      has_access: !!req.cookies?.[CK_ACCESS],
      has_refresh: !!req.cookies?.[CK_REFRESH],
    },
  });
});

/** 가벼운 상태: 쿠키만 기준 */
router.get("/status", (req, res) => {
  res.json({
    connected: !!req.cookies?.[CK_ACCESS] || !!req.cookies?.[CK_REFRESH],
  });
});

/* ─────────────── 로그인 시작 ─────────────── */
router.get(["/login", "/authorize"], (req, res) => {
  const returnTo = safeReturnTo(req.query.return);
  const state = b64url(JSON.stringify({ r: returnTo }));

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
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${p.toString()}`);
});

/* ─────────────── 콜백 ─────────────── */
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
      timeout: 10000,
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data || {};
    setAccessCookie(res, access_token, expires_in);
    if (refresh_token) setRefreshCookie(res, refresh_token);

    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=1&r=${encodeURIComponent(returnTo)}`);
  } catch (err) {
    console.error("[spotify/callback]", err?.response?.data || err.message);
    clearSpotifyCookies(res);
    return res.redirect(`${FRONT_BASE}/spotify-callback?ok=0&r=${encodeURIComponent("/")}`);
  }
});

/* ─────────────── /me (캐시) ─────────────── */
router.get("/me", async (req, res) => {
  const access = req.cookies?.[CK_ACCESS] || null;
  try {
    if (!access) return res.status(401).json({ connected: false });

    const now = Date.now();
    const cached = meCache.get(access);

    if (cached && cached.profile && now - cached.ts < ME_TTL_MS) {
      return res.json({ connected: true, profile: cached.profile, cached: true });
    }
    if (cached?.pending) {
      await cached.pending;
      const again = meCache.get(access);
      if (again?.profile) {
        return res.json({ connected: true, profile: again.profile, cached: true });
      }
    }

    const pending = (async () => {
      const r = await callSpotifyWithCookies(req, res, "GET", "https://api.spotify.com/v1/me");
      const profile = r.data;
      meCache.set(access, { ts: Date.now(), profile });
      return profile;
    })();

    meCache.set(access, { ts: now, profile: null, pending });

    const profile = await pending;
    return res.json({ connected: true, profile });

  } catch (e) {
    const s = e?.response?.status || 500;
    if (s === 401) return res.status(401).json({ connected: false });
    return res.status(s).json(e?.response?.data || { error: "me_failed" });
  } finally {
    const c = meCache.get(access);
    if (c) meCache.set(access, { ts: c.ts, profile: c.profile });
  }
});

/* ─────────────── SDK 전용 토큰 (중요!) ─────────────── */
// Web Playback SDK 에 공급할 액세스 토큰 반환.
// - sp_access가 있으면 그대로 반환
// - 없고 sp_refresh가 있으면 refresh로 새 토큰 발급 후 반환
router.get("/token", async (req, res) => {
  try {
    const access = req.cookies?.[CK_ACCESS] || null;
    const refresh = req.cookies?.[CK_REFRESH] || null;

    if (access) {
      return res.json({ access_token: access });
    }

    if (refresh) {
      const ref = await refreshAccessToken(refresh);
      if (ref?.access_token) {
        setAccessCookie(res, ref.access_token, ref.expires_in);
        return res.json({ access_token: ref.access_token });
      }
    }

    return res.status(401).json({ error: "not_connected" });
  } catch (e) {
    console.error("[/api/spotify/token]", e?.response?.data || e.message);
    return res.status(500).json({ error: "token_failed" });
  }
});

/* ─────────────── 재생 관련 (메서드 양쪽 허용) ─────────────── */

// 디바이스 목록
router.get("/devices", async (req, res) => {
  try {
    const r = await callSpotifyWithCookies(req, res, "GET", "https://api.spotify.com/v1/me/player/devices");
    res.json(r.data);
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
});

// transfer (PUT/POST 둘 다 허용)
async function handleTransfer(req, res) {
  try {
    await callSpotifyWithCookies(
      req, res, "PUT", "https://api.spotify.com/v1/me/player",
      { device_ids: [req.body?.device_id], play: !!req.body?.play }
    );
    res.json({ ok: true });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
}
router.put("/transfer", handleTransfer);
router.post("/transfer", handleTransfer);

// play (PUT/POST 둘 다 허용)
async function handlePlay(req, res) {
  try {
    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (req.body?.device_id) url.searchParams.set("device_id", String(req.body.device_id));
    await callSpotifyWithCookies(req, res, "PUT", url.toString(), req.body);
    res.json({ ok: true });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
}
router.put("/play", handlePlay);
router.post("/play", handlePlay);

// pause (PUT/POST 둘 다 허용)
async function handlePause(req, res) {
  try {
    await callSpotifyWithCookies(req, res, "PUT", "https://api.spotify.com/v1/me/player/pause", {});
    res.json({ ok: true });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
}
router.put("/pause", handlePause);
router.post("/pause", handlePause);

// next/previous(POST)
router.post("/next", async (req, res) => {
  try {
    await callSpotifyWithCookies(req, res, "POST", "https://api.spotify.com/v1/me/player/next", {});
    res.json({ ok: true });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
});

router.post("/previous", async (req, res) => {
  try {
    await callSpotifyWithCookies(req, res, "POST", "https://api.spotify.com/v1/me/player/previous", {});
    res.json({ ok: true });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
});

/* ───────────────────────────────────────────────────────────
   검색 (커버/미리듣기 포함) — 쿠키 기반 → 실패 시 App 토큰 폴백
   ─────────────────────────────────────────────────────────── */
function compactTrack(t) {
  if (!t) return null;
  const imgs = t.album?.images || [];
  const albumImage =
    imgs?.[1]?.url || imgs?.[0]?.url || imgs?.[2]?.url || null;
  return {
    id: t.id || null,
    title: t.name || null,
    artist: Array.isArray(t.artists) ? t.artists.map(a => a.name).join(", ") : null,
    album: t.album?.name || null,
    albumImage,
    preview_url: t.preview_url || null,
    spotify_uri: t.uri || null,
  };
}

router.get("/search", async (req, res) => {
  try {
    // title/artist를 받아 q로 합쳐줌
    let q = req.query.q || req.query.query;
    const title = req.query.title;
    const artist = req.query.artist;
    if (!q && (title || artist)) {
      const t = title ? `track:${String(title)}` : "";
      const a = artist ? ` artist:${String(artist)}` : "";
      q = `${t}${a}`.trim();
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 5);
    if (!q) return res.status(400).json({ error: "missing_q" });

    let data;
    try {
      // 1) 사용자 토큰으로 시도
      const r = await callSpotifyWithCookies(
        req, res, "GET", "https://api.spotify.com/v1/search", null,
        { q: String(q), type: "track", limit }
      );
      data = r.data;
    } catch (e) {
      // 2) 로그인 안 되어있거나 401 → Client Credentials Flow로 fallback
      const appToken = await getAppToken();
      const r2 = await axios.get("https://api.spotify.com/v1/search", {
        params: { q: String(q), type: "track", limit },
        headers: { Authorization: `Bearer ${appToken}` },
        timeout: 10000,
      });
      data = r2.data;
      res.set("Cache-Control", "public, max-age=60");
    }

    const tracks = data?.tracks?.items || [];
    const items = tracks.map(compactTrack);
    res.json({ items });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
});

/* ───────────────────────────────────────────────────────────
   단일 트랙 상세 (커버/미리듣기 보강용)
   GET /api/spotify/tracks/:id
   ─────────────────────────────────────────────────────────── */
router.get("/tracks/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "missing_id" });

    let track;
    try {
      const r = await callSpotifyWithCookies(
        req, res, "GET", `https://api.spotify.com/v1/tracks/${id}`
      );
      track = r.data;
    } catch (e) {
      const appToken = await getAppToken();
      const r2 = await axios.get(`https://api.spotify.com/v1/tracks/${id}`, {
        headers: { Authorization: `Bearer ${appToken}` },
        timeout: 10000,
      });
      track = r2.data;
      res.set("Cache-Control", "public, max-age=120");
    }

    return res.json({ item: compactTrack(track) });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
});

/* ───────────────────────────────────────────────────────────
   배치 검색: [{title, artist}] → { items: [{key, ...compactTrack}] }
   ─────────────────────────────────────────────────────────── */
router.post("/search/batch", async (req, res) => {
  try {
    const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
    if (pairs.length === 0) return res.json({ items: [] });

    // 1) 사용자 토큰이 있으면 재사용
    let bearer = null;
    const access = req.cookies?.[CK_ACCESS];
    if (access) {
      bearer = `Bearer ${access}`;
    } else {
      // 2) 없으면 Client Credentials 1회 발급
      const appToken = await getAppToken();
      bearer = `Bearer ${appToken}`;
      res.set("Cache-Control", "public, max-age=120");
    }

    // 키 생성 규칙 (프론트 keyOf와 동일)
    const makeKey = (t, a) => `${String(t||"").trim().toLowerCase()} - ${String(a||"").trim().toLowerCase()}`;

    // 간단 동시성 제한(5개씩)
    const chunk = (arr, n) => arr.reduce((acc, _, i) => (i % n ? acc : acc.concat([arr.slice(i, i + n)])), []);

    const groups = chunk(pairs, 5);
    const out = [];
    for (const g of groups) {
      const tasks = g.map(async ({ title, artist }) => {
        const key = makeKey(title, artist);
        const q = `${title ? `track:${title}` : ""}${artist ? ` artist:${artist}` : ""}`.trim();
        if (!q) return { key, ...{ id:null, title:title||null, artist:artist||null, album:null, albumImage:null, preview_url:null, spotify_uri:null } };

        const r = await axios.get("https://api.spotify.com/v1/search", {
          params: { q, type: "track", limit: 1 },
          headers: { Authorization: bearer },
          timeout: 10000,
        }).catch(() => null);

        const t = r?.data?.tracks?.items?.[0] || null;
        const c = compactTrack(t) || { id:null, title:title||null, artist:artist||null, album:null, albumImage:null, preview_url:null, spotify_uri:null };

        return { key, ...c };
      });
      const part = await Promise.all(tasks);
      out.push(...part);
    }

    return res.json({ items: out });
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
});

/* ─────────────── 연결 해제 ─────────────── */
router.post("/logout", (req, res) => {
  clearSpotifyCookies(res);
  res.json({ ok: true });
});

module.exports = router;
