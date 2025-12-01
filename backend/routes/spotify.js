// routes/spotify.js
// Spotify 연동 관련 라우터
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const NodeCache = require("node-cache");

const router = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI; 
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

// Axios 인스턴스
const axiosSpotify = axios.create({ timeout: 10000 });

// 토큰별 /me 캐시
const meCache = new Map(); 
const ME_TTL_MS = 60 * 1000;

// 유틸리티 함수
const b64url = (bufOrStr) =>
  Buffer.from(bufOrStr).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");

const b64urlToStr = (s="") => {
  const base64 = String(s).replace(/-/g,"+").replace(/_/g,"/");
  const pad = base64.length % 4 ? 4 - (base64.length % 4) : 0;
  return Buffer.from(base64 + "=".repeat(pad), "base64").toString("utf8");
};

const safeReturnTo = (val) => (typeof val === "string" && /^\/(?!\/)/.test(val) ? val : "/");

// 쿠키 설정 함수
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

// 앱 토큰 획득 
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

// 토큰 갱신
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
    return r.data;
  } catch (e) {
    console.error("[spotify] refreshAccessToken:", e?.response?.data || e.message);
    return null;
  }
}

// Axios 오류 포맷팅
function formatAxiosErr(e) {
  const status = e?.response?.status || 500;
  const data = e?.response?.data || { error: e.message || "unknown_error" };
  console.error("[spotify api error]", status, data);
  return { status, data };
}

// Spotify API 호출 (쿠키 기반, 자동 리프레시)
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
    
    const ref = await refreshAccessToken(refresh);
    if (!ref || typeof ref.access_token !== 'string' || !ref.access_token) {
        console.error("[callSpotifyWithCookies] Refresh failed or returned invalid token:", ref);
        clearSpotifyCookies(res); 
        throw e1; 
    }

    setAccessCookie(res, ref.access_token, ref.expires_in);
    const r2 = await doCall(ref.access_token);
    return r2;
  }
}

// 헬스체크
router.get("/__health", (req, res) => res.json({ ok: true }));

// 디버그 정보
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

// 연결 상태 조회
router.get("/status", (req, res) => {
  res.json({
    connected: !!req.cookies?.[CK_ACCESS] || !!req.cookies?.[CK_REFRESH],
  });
});

// 로그인/인가 시작
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

// 콜백 처리
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

// /me 엔드포인트 캐싱 및 글로벌 백오프
let GLOBAL_BACKOFF_UNTIL = 0;

// GET /api/spotify/me
// 현재 사용자 프로필 조회
router.get("/me", async (req, res) => {
  const access = req.cookies?.[CK_ACCESS] || null;
  try {
    
    if (!access) {
      return res.json({ connected: false });
    }

    const now = Date.now();

    // 글로벌 백오프 중이면 바로 응답
    if (now < GLOBAL_BACKOFF_UNTIL) {
      return res.json({ connected: false, rate_limited: true, backoff: Math.ceil((GLOBAL_BACKOFF_UNTIL - now)/1000) });
    }

    const cached = meCache.get(access);

    // 캐시 유효하면 사용
    if (cached && cached.profile && now - cached.ts < ME_TTL_MS) {
      return res.json({ connected: true, profile: cached.profile, cached: true });
    }

    // 진행 중인 요청이 있으면 대기했다 사용
    if (cached?.pending) {
      await cached.pending;
      const again = meCache.get(access);
      if (again?.profile) {
        return res.json({ connected: true, profile: again.profile, cached: true });
      }
    }

    // 새 요청 시작
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

    // 401/403 → 연결 끊김
    if (status === 401 || status === 403) {
      return res.json({ connected: false });
    }

    // 429 레이트 리밋
    if (status === 429) {
    
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

    // 기타 오류
    console.error("[/api/spotify/me] unexpected:", status, e?.response?.data || e.message);
    return res.json({ connected: false });
  } finally {
    
    const c = meCache.get(access);
    if (c) meCache.set(access, { ts: c.ts, profile: c.profile });
  }
});


// GET /api/spotify/token
// 액세스 토큰 조회 (필요시 리프레시 시도)
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

// GET /api/spotify/devices
// 사용자 디바이스 목록 조회
router.get("/devices", async (req, res) => {
  try {
    const r = await callSpotifyWithCookies(req, res, "GET", "https://api.spotify.com/v1/me/player/devices");
    res.json(r.data);
  } catch (e) {
    const { status, data } = formatAxiosErr(e);
    res.status(status).json(data);
  }
});

// transfer 
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

// play 
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

// pause 
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

// 트랙 정보 압축
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

// 트랙 검색 
router.get("/search", async (req, res) => {
  try {
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

    // 캐시 조회
    const cacheKey = `search:q=${q}:limit=${limit}`;
    const cachedData = spotifyApiCache.get(cacheKey);

    if (cachedData) {
      console.log(`[Cache HIT] ${cacheKey}`);
      const items = cachedData.map(compactTrack);
      return res.json({ items });
    }
    console.log(`[Cache MISS] ${cacheKey}`);

    let data;
    try {
      // 사용자 토큰으로 시도
      const r = await callSpotifyWithCookies(
        req, res, "GET", "https://api.spotify.com/v1/search", null,
        { q: String(q), type: "track", limit }
      );
      data = r.data;
    } catch (e) {
      // 앱 토큰으로 폴백
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

// GET /api/spotify/tracks/:id
// 단일 트랙 조회
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

// POST /api/spotify/search/batch
// 트랙 정보 일괄 검색
router.post("/search/batch", async (req, res) => {
  try {
    const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
    if (pairs.length === 0) return res.json({ items: [] });

    // 사용자 토큰이 있으면 재사용
    let bearer = null;
    const access = req.cookies?.[CK_ACCESS];
    if (access) {
      bearer = `Bearer ${access}`;
    } else {
      // 없으면 앱 토큰 1회 발급
      const appToken = await getAppToken();
      bearer = `Bearer ${appToken}`;
      res.set("Cache-Control", "public, max-age=120");
    }

    const norm = (s = "") =>
      String(s || "")
        .replace(/\s+/g, " ")
        .replace(/[[(（【].*?[)\]）】]/g, "")
        .trim()
        .toLowerCase();

    // 키 생성 규칙
    const makeKey = (t, a) => `${norm(t)} - ${norm(a)}`;
    const results = {};
    const itemsToFetch = []; 

    for (const { title, artist } of pairs) {
      const key = makeKey(title, artist);
      const cacheKey = `search:q=track:${String(title||'').trim()} artist:${String(artist||'').trim()}:limit=1`;
      const cachedItem = spotifyApiCache.get(cacheKey); 

      if (cachedItem) {
        console.log(`[Batch Cache HIT] ${cacheKey}`);
        results[key] = { key, ...compactTrack(cachedItem) };
      } else {
        console.log(`[Batch Cache MISS] ${cacheKey}`);
        itemsToFetch.push({ title, artist, cacheKey }); 
      }
    }

    // API 호출 및 캐싱
    const chunk = (arr, n) => arr.reduce((acc, _, i) => (i % n ? acc : acc.concat([arr.slice(i, i + n)])), []);
    
    const groups = chunk(pairs, 5);
    
    for (const g of groups) {
      const tasks = g.map(async ({ title, artist, cacheKey }) => {
        const q = `${title ? `track:${title}` : ""}${artist ? ` artist:${artist}` : ""}`.trim();
        if (!q) return { cacheKey, trackData: null, originalTitle: title, originalArtist: artist }; 

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
          return { cacheKey, trackData: null, originalTitle: title, originalArtist: artist }; 
        }
      });

    const responses = await Promise.all(tasks);

    for (const responseItem of responses) {
        // 응답 항목 유효성 검사
        if (!responseItem || typeof responseItem !== 'object') {
            console.error("[Batch Processing Error] Invalid response item:", responseItem);
            continue; 
        }

        const { trackData, originalTitle, originalArtist } = responseItem;
        const key = makeKey(originalTitle, originalArtist);

        if (typeof key !== 'string' || !key) {
            console.error(`[Batch Processing Error] Generated key is invalid. Original: title='${originalTitle}', artist='${originalArtist}'. Response item:`, responseItem);
            continue;
        }
        
        // 캐시에 저장
        if (trackData) {

          const currentCacheKey = `search:q=track:${String(originalTitle||'').trim()} artist:${String(originalArtist||'').trim()}:limit=1`;

            if (typeof currentCacheKey === 'string' && currentCacheKey) {
                spotifyApiCache.set(currentCacheKey, trackData);
            } else {
                // 캐시 키가 유효하지 않으면 로그만 남김
                console.warn(`[Batch Cache Warn] Invalid or missing cacheKey for key: ${key}, cannot cache.`);
            }
        }
        // 결과를 최종 결과 객체에 추가
        const c = compactTrack(trackData) || { id: null, title: originalTitle, artist: originalArtist, album: null, albumImage: null, preview_url: null, spotify_uri: null };
        results[key] = { key, ...c };
      }
    }

    const orderedResults = pairs.map(({ title, artist }) => {
        const key = makeKey(title, artist); 
        return results[key] || { key, id: null, title, artist, album: null, albumImage: null, preview_url: null, spotify_uri: null };
    });

    return res.json({ items: orderedResults });
  } catch (e) {
    console.error("[/api/spotify/search/batch] Handler Error:", e); 
    const { status, data } = formatAxiosErr(e);
    res.status(status || 500).json(data || { error: "Batch search failed" });
  }
});

// POST /api/spotify/logout
// 연결 해제
router.post("/logout", (req, res) => {
  clearSpotifyCookies(res);
  res.json({ ok: true });
});

module.exports = router;
