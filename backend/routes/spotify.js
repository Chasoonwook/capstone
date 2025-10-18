// routes/spotify.js
// Spotify Web Playback + REST 프록시 라우터 (커버/미리듣기/SDK 토큰 포함)

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const NodeCache = require("node-cache");

const router = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI; // e.g. https://.../api/spotify/callback
const FRONT_BASE    = process.env.FRONT_BASE || "https://capstone-front-tau.vercel.app";

const CK_ACCESS  = "sp_access";
const CK_REFRESH = "sp_refresh";

const spotifyApiCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });

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
    if (!ref || typeof ref.access_token !== 'string' || !ref.access_token) {
        console.error("[callSpotifyWithCookies] Refresh failed or returned invalid token:", ref);
        clearSpotifyCookies(res); // 문제가 있는 토큰 관련 쿠키 삭제
        throw e1; // 원래 오류 다시 발생시킴
    }

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

/* ─────────────── /me (캐시 + 레이트리밋 완화) ─────────────── */

// 429 대응 전역 백오프(모든 유저 공통. 필요 시 per-IP로 확장 가능)
let GLOBAL_BACKOFF_UNTIL = 0;

router.get("/me", async (req, res) => {
  const access = req.cookies?.[CK_ACCESS] || null;
  try {
    // 아직 연결 안 된 상태: 항상 200으로
    if (!access) {
      return res.json({ connected: false });
    }

    const now = Date.now();

    // 글로벌 백오프 중이면 호출 생략하고 바로 false
    if (now < GLOBAL_BACKOFF_UNTIL) {
      return res.json({ connected: false, rate_limited: true, backoff: Math.ceil((GLOBAL_BACKOFF_UNTIL - now)/1000) });
    }

    const cached = meCache.get(access);

    // 토큰별 캐시 HIT
    if (cached && cached.profile && now - cached.ts < ME_TTL_MS) {
      return res.json({ connected: true, profile: cached.profile, cached: true });
    }

    // 누군가 이미 호출 중이면 그거 기다렸다가 결과 사용
    if (cached?.pending) {
      await cached.pending;
      const again = meCache.get(access);
      if (again?.profile) {
        return res.json({ connected: true, profile: again.profile, cached: true });
      }
      // pending 끝났는데도 profile이 없다면 아래에서 새로 시도
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
    const status = e?.response?.status || 500;

    // 401/403(토큰 만료/권한 문제) → 연결 안 된 것으로 처리
    if (status === 401 || status === 403) {
      return res.json({ connected: false });
    }

    // 429(Spotify rate limit) → 항상 200 + 글로벌 백오프
    if (status === 429) {
      // Spotify가 주는 Retry-After 헤더(초) 사용, 기본 10초 (상한 60초)
      const retryAfterSec = Math.min(
        60,
        Number(e?.response?.headers?.["retry-after"] || 10)
      );
      GLOBAL_BACKOFF_UNTIL = Date.now() + retryAfterSec * 1000;

      return res.json({
        connected: false,
        rate_limited: true,
        retryAfter: retryAfterSec,
      });
    }

    // 그 외 오류도 200으로 완화
    console.error("[/api/spotify/me] unexpected:", status, e?.response?.data || e.message);
    return res.json({ connected: false });
  } finally {
    // pending 플래그 정리
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

    // 캐싱 로직
    const cacheKey = 'search:q=${q}:limit=${limit}';
    const cachedData = spotifyApiCache.get(cacheKey);

    if (cachedData) {
      console.log(`[Cache HIT] ${cacheKey}`);
      const items = cachedData.map(compactTrack);
      return res.json({ items });
    }
    console.log(`[Cache MISS] ${cacheKey}`);

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

    spotifyApiCache.set(cacheKey, tracks);

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

    const cacheKey = 'track:${id}';
    const cachedData = spotifyApiCache.get(cacheKey);

    if (cachedData) {
      console.log(`[Cache HIT] ${cacheKey}`);
      return res.json({ item: compactTrack(cachedData) });
    }
    console.log(`[Cache MISS] ${cacheKey}`);

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

    if(track) {
      spotifyApiCache.set(cacheKey, track);
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

    const norm = (s = "") =>
      String(s || "")
        .replace(/\s+/g, " ")
        .replace(/[[(（【].*?[)\]）】]/g, "") // 괄호 내용 제거 (프론트엔드와 동일하게)
        .trim()
        .toLowerCase();

    // 키 생성 규칙 (프론트 keyOf와 동일)
    const makeKey = (t, a) => `${norm(t)} - ${norm(a)}`;
    const results = {};
    const itemsToFetch = []; // API로 조회해야 할 항목들

    for (const { title, artist } of pairs) {
      const key = makeKey(title, artist);
      const cacheKey = `search:q=track:${String(title||'').trim()} artist:${String(artist||'').trim()}:limit=1`;
      const cachedItem = spotifyApiCache.get(cacheKey); // 단일 트랙 결과를 가져옴 (배열 아님)

      if (cachedItem) {
        console.log(`[Batch Cache HIT] ${cacheKey}`);
        results[key] = { key, ...compactTrack(cachedItem) };
      } else {
        console.log(`[Batch Cache MISS] ${cacheKey}`);
        itemsToFetch.push({ title, artist, cacheKey }); // 캐시에 없으면 조회 목록에 추가
      }
    }

    // 간단 동시성 제한(5개씩)
    const chunk = (arr, n) => arr.reduce((acc, _, i) => (i % n ? acc : acc.concat([arr.slice(i, i + n)])), []);
    
    const groups = chunk(pairs, 5);
    
    for (const g of groups) {
      const tasks = g.map(async ({ title, artist, cacheKey }) => {
        const q = `${title ? `track:${title}` : ""}${artist ? ` artist:${artist}` : ""}`.trim();
        if (!q) return { cacheKey, trackData: null, originalTitle: title, originalArtist: artist }; // 검색어 없으면 null

        try {
          const r = await axios.get("https://api.spotify.com/v1/search", {
            params: { q, type: "track", limit: 1 },
            headers: { Authorization: bearer },
            timeout: 10000,
          });
          const trackData = r?.data?.tracks?.items?.[0] || null;
          return { cacheKey, trackData, originalTitle: title, originalArtist: artist };
        } catch (err) {
          console.error(`[Batch API Error] q=${q}:`, err?.response?.status || err.message);
          return { cacheKey, trackData: null, originalTitle: title, originalArtist: artist }; // API 오류 시 null
        }
      });

    const responses = await Promise.all(tasks);

    for (const responseItem of responses) {
        // --- responseItem 및 내부 속성 유효성 검사 강화 ---
        if (!responseItem || typeof responseItem !== 'object') {
            console.error("[Batch Processing Error] Invalid response item:", responseItem);
            continue; // 다음 항목으로 건너뛰기
        }

        const { cacheKey, trackData, originalTitle, originalArtist } = responseItem;
        
        const key = makeKey(originalTitle, originalArtist);

        if (typeof key !== 'string' || !key) {
            console.error(`[Batch Processing Error] Generated key is invalid. Original: title='${originalTitle}', artist='${originalArtist}'. Response item:`, responseItem);
            // key가 없으면 results에 추가할 수 없으므로 건너뛰거나 기본값 처리
            continue;
        }
        
        // API 호출 결과를 캐시에 저장 (오류 시 저장 안 함)
        if (trackData) {
            if (typeof cacheKey === 'string' && cacheKey) {
                spotifyApiCache.set(cacheKey, trackData);
            } else {
                // cacheKey가 유효하지 않으면 로그만 남김
                console.warn(`[Batch Cache Warn] Invalid or missing cacheKey for key: ${key}, cannot cache.`);
            }
        }
        // 결과를 최종 결과 객체에 추가
        const c = compactTrack(trackData) || { id: null, title: originalTitle, artist: originalArtist, album: null, albumImage: null, preview_url: null, spotify_uri: null };
        results[key] = { key, ...c };
      }
      // --- 캐싱 로직 끝 ---
    }

    const orderedResults = pairs.map(({ title, artist }) => {
        const key = makeKey(title, artist); // 최종 정렬 시에도 동일한 makeKey 사용
        // 결과 객체에 해당 key가 없을 경우 (오류 등으로 인해) 대비하여 기본값 반환
        return results[key] || { key, id: null, title, artist, album: null, albumImage: null, preview_url: null, spotify_uri: null };
    });

    return res.json({ items: orderedResults });
  } catch (e) {
    console.error("[/api/spotify/search/batch] Handler Error:", e); // <-- 전체 에러 로깅 추가
    const { status, data } = formatAxiosErr(e);
    res.status(status || 500).json(data || { error: "Batch search failed" });
  }
});

/* ─────────────── 연결 해제 ─────────────── */
router.post("/logout", (req, res) => {
  clearSpotifyCookies(res);
  res.json({ ok: true });
});

module.exports = router;
