// server.js
const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config({ debug: true });
const pool = require("./db");

const app = express();
app.set("trust proxy", 1);

/* =======================================================================
   Body parsers (JSON/폼) — req.body가 비는 문제 방지
   ======================================================================= */
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* =======================================================================
   요청별 응답 타임아웃 120초 (외부 API 지연 대비)
   ======================================================================= */
app.use((req, res, next) => {
  res.setTimeout(120000);
  next();
});

/* =======================================================================
   CORS 설정
   ======================================================================= */
const FRONT_BASE = process.env.FRONT_BASE || "https://capstone-front-tau.vercel.app";

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  FRONT_BASE,
];

// 자기 자신(배포 주소)도 허용
const selfOrigin = process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : null);
if (selfOrigin && !allowedOrigins.includes(selfOrigin)) {
  allowedOrigins.push(selfOrigin);
}

console.log("[CORS] Allowed Origins:", allowedOrigins); // 허용 목록 확인용 로그

app.use(cors({
  origin: function (origin, callback) {
    // !origin은 Postman 등 origin 없는 요청 허용 (개발 시 유용)
    // 실제 배포 시에는 !origin을 제거하거나 더 엄격하게 관리할 수 있음
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      console.log(`[CORS] Allowing origin: ${origin || 'server-to-server'}`); // 허용 로그
      callback(null, true);
    } else {
      console.error(`[CORS] Blocking origin: ${origin}`); // 차단 로그
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // 쿠키 공유 허용
  exposedHeaders: ['Set-Cookie'], // 필요 시 Set-Cookie 헤더 노출
  // allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-User-Id'], // 명시적으로 헤더 지정 가능 (기본값으로도 충분할 수 있음)
  optionsSuccessStatus: 204 // OPTIONS 요청에 204 응답
}));

/* =======================================================================
   health
   ======================================================================= */
app.get("/", (_req, res) => res.send("정상작동"));
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.send("Server & Database connection OK");
  } catch (e) {
    console.error(e);
    res.status(500).send("Database connection failed");
  }
});

/* =======================================================================
   Spotify 라우터 (가장 먼저 마운트)
   ======================================================================= */
let SPOTIFY_MOUNTED = false;
let SPOTIFY_FILE_EXISTS = false;

try {
  const spotifyPath = path.join(__dirname, "routes/spotify.js");
  SPOTIFY_FILE_EXISTS = fs.existsSync(spotifyPath);
  if (!SPOTIFY_FILE_EXISTS) {
    console.error(`[router] routes/spotify.js 파일이 없습니다: ${spotifyPath}`);
  } else {
    const spotifyRoutes = require("./routes/spotify");
    if (typeof spotifyRoutes !== "function") {
      throw new Error("routes/spotify export가 함수가 아닙니다 (module.exports = router 필요)");
    }
    app.use(
      "/api/spotify",
      (req, _res, next) => {
        console.log(`[hit] /api/spotify ${req.method} ${req.originalUrl}`);
        next();
      },
      spotifyRoutes
    );
    SPOTIFY_MOUNTED = true;
    console.log("[router] mounted: /api/spotify (routes/spotify.js)");
  }
} catch (e) {
  console.error("[router] FAILED to mount /api/spotify:", (e && (e.stack || e.message)) || e);
}

/* =======================================================================
   SDK용 토큰 엔드포인트 (쿠키→유효 access_token 반환)
   ======================================================================= */
const CK_ACCESS = "sp_access";
const CK_REFRESH = "sp_refresh";
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

async function refreshAccessToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: String(SPOTIFY_CLIENT_ID),
      client_secret: String(SPOTIFY_CLIENT_SECRET),
    });
    const resp = await axios.post(
      "https://accounts.spotify.com/api/token",
      body.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    return resp.data; // { access_token, expires_in, ... }
  } catch (e) {
    console.error("[spotify] refreshAccessToken error:", e?.response?.data || e.message);
    return null;
  }
}

app.get("/api/spotify/token", async (req, res) => {
  try {
    let access = req.cookies?.[CK_ACCESS] || null;
    const refresh = req.cookies?.[CK_REFRESH] || null;

    const tryMe = async (token) =>
      axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      });

    let expiresIn = 300;

    if (access) {
      try {
        await tryMe(access);
        res.set("Cache-Control", "no-store");
        return res.json({ access_token: access, expires_in: expiresIn });
      } catch {
        // access 만료 → 아래에서 refresh 시도
      }
    }

    if (!refresh) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const refreshed = await refreshAccessToken(refresh);
    if (!refreshed?.access_token) {
      return res.status(401).json({ error: "refresh_failed" });
    }

    const newAccess = refreshed.access_token;
    const newTtl = Number(refreshed.expires_in || 300);

    res.cookie(CK_ACCESS, newAccess, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: newTtl * 1000,
    });

    res.set("Cache-Control", "no-store");
    return res.json({ access_token: newAccess, expires_in: newTtl });
  } catch (e) {
    console.error("[/api/spotify/token] error:", e?.response?.data || e.message);
    return res.status(500).json({ error: "token_failed" });
  }
});

/* =======================================================================
   ✨ (추가) 검색용 라우트 4종 — 프론트의 Search/Player에서 사용
   - /api/spotify/search, /api/spotify/search/batch
   - /api/deezer/search,  /api/itunes/search
   ======================================================================= */

/** ─ Spotify: 앱 크리덴셜 토큰 캐시 (사용자 연동 없어도 검색 가능) ─ */
let _ccToken = null;
let _ccExpireAt = 0;
async function getClientCredentialsToken() {
  if (!_ccToken || Date.now() >= _ccExpireAt) {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return null; // 환경변수 없으면 건너뜀
    }
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
    const resp = await axios.post("https://accounts.spotify.com/api/token", body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      timeout: 10000,
    });
    _ccToken = resp.data?.access_token || null;
    const ttl = Number(resp.data?.expires_in || 300);
    _ccExpireAt = Date.now() + (ttl - 30) * 1000; // 30초 여유
  }
  return _ccToken;
}

/** GET /api/spotify/search?title=&artist=&limit=1 */
app.get("/api/spotify/search", async (req, res) => {
  try {
    const { title = "", artist = "", limit = "1" } = req.query;
    const query = [title ? `track:${title}` : null, artist ? `artist:${artist}` : null]
      .filter(Boolean)
      .join(" ");
    const token = await getClientCredentialsToken();

    if (!token || !query) {
      // 토큰 혹은 쿼리가 없으면 프론트가 fallback(deezer/itunes) 하도록 빈 구조 반환
      return res.json({ tracks: { items: [] } });
    }

    const r = await axios.get("https://api.spotify.com/v1/search", {
      params: { q: query, type: "track", limit },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 12000,
    });

    // 프론트는 data.tracks.items 또는 data.items 등 유연히 읽음
    res.json({ tracks: r.data?.tracks || { items: [] } });
  } catch (e) {
    console.warn("[/api/spotify/search] fallback with empty:", e?.response?.data || e.message);
    res.json({ tracks: { items: [] } });
  }
});

/** POST /api/spotify/search/batch  { pairs: [{title, artist}, ...] } */
app.post("/api/spotify/search/batch", async (req, res) => {
  try {
    const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
    if (pairs.length === 0) return res.json({ items: [] });

    const token = await getClientCredentialsToken();
    // 토큰 없으면 앨범 이미지 없이 키만 돌려주기 (프론트는 null 허용)
    if (!token) {
      return res.json({
        items: pairs.map((p) => ({
          key: `${(p.title || "").trim().toLowerCase()} - ${(p.artist || "").trim().toLowerCase()}`,
          albumImage: null,
        })),
      });
    }

    const tasks = pairs.map(async (p) => {
      const key = `${(p.title || "").trim().toLowerCase()} - ${(p.artist || "").trim().toLowerCase()}`;
      const q = [p.title ? `track:${p.title}` : null, p.artist ? `artist:${p.artist}` : null]
        .filter(Boolean)
        .join(" ");
      if (!q) return { key, albumImage: null };

      try {
        const r = await axios.get("https://api.spotify.com/v1/search", {
          params: { q, type: "track", limit: 1 },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 12000,
        });
        const item = r.data?.tracks?.items?.[0] || null;
        const albumImage =
          item?.album?.images?.[0]?.url ||
          item?.album?.images?.[1]?.url ||
          item?.album?.images?.[2]?.url ||
          null;
        return {
          key,
          albumImage,
          title: item?.name || null,
          artist: item?.artists?.map((a) => a.name).join(", ") || null,
          trackId: item?.id || null,
        };
      } catch {
        return { key, albumImage: null };
      }
    });

    const items = await Promise.all(tasks);
    res.json({ items });
  } catch (e) {
    console.warn("[/api/spotify/search/batch] error:", e?.response?.data || e.message);
    res.json({ items: [] });
  }
});

/** GET /api/deezer/search?title=&artist=&limit=1  (공식 공개 API) */
app.get("/api/deezer/search", async (req, res) => {
  try {
    const { title = "", artist = "", limit = "1" } = req.query;
    const parts = [];
    if (title) parts.push(`track:"${title}"`);
    if (artist) parts.push(`artist:"${artist}"`);
    const q = parts.join(" ") || (title || artist || "");
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(
      String(limit)
    )}`;
    const r = await axios.get(url, { timeout: 12000 });
    // 프론트는 data.data[0] 형태를 읽을 수 있음
    res.json(r.data || { data: [] });
  } catch (e) {
    console.warn("[/api/deezer/search] fallback with empty:", e?.response?.data || e.message);
    res.json({ data: [] });
  }
});

/** GET /api/itunes/search?title=&artist=&limit=1  (공식 공개 API) */
app.get("/api/itunes/search", async (req, res) => {
  try {
    const { title = "", artist = "", limit = "1", country = "KR" } = req.query;
    const term = `${title} ${artist}`.trim();
    if (!term) return res.json({ results: [] });
    const r = await axios.get("https://itunes.apple.com/search", {
      params: {
        term,
        entity: "song",
        limit: String(limit || 1),
        country: String(country || "KR"),
      },
      timeout: 12000,
    });
    // 프론트는 data.results[0] 형태를 읽음
    res.json(r.data || { results: [] });
  } catch (e) {
    console.warn("[/api/itunes/search] fallback with empty:", e?.response?.data || e.message);
    res.json({ results: [] });
  }
});

/* =======================================================================
   라우터 자동 로더
   ======================================================================= */
function loadRoute(relPath) {
  try {
    const abs = path.join(__dirname, relPath);
    if (!fs.existsSync(abs) && !fs.existsSync(abs + ".js")) {
      console.warn(`[router] skip: ${relPath} (not found) abs=${abs}`);
      return null;
    }
    const mod = require(abs);
    const router = (mod && (mod.default || mod)) ?? null;
    if (typeof router !== "function") {
      console.warn(`[router] skip: ${relPath} (export is not a function)`);
      return null;
    }
    console.log(`[router] loaded: ${relPath}`);
    return router;
  } catch (e) {
    console.warn(`[router] skip: ${relPath} (${e.code || e.message})`);
    return null;
  }
}

/**
 * ✅ rankings 라우터는 구버전 경로도 함께 마운트
 */
const mounts = [
  ["/api/photos", "routes/photos"],
  ["/api/recommendations", "routes/recommendations"],
  ["/api/images", "routes/images"],
  ["/api/users", "routes/users"],
  ["/api/musics", "routes/musics"],
  ["/api/auth", "routes/auth"],
  ["/api", "routes/onboarding"],
  ["/api/history", "routes/history"],
  ["/api/music-requests", "routes/musicRequests"],
  ["/api", "routes/feedback"],
  ["/api", "routes/stickers"],
  ["/api/diaries", "routes/diaries"],
  ["/api/rankings", "routes/rankings"],
  ["/api/rankings-simple", "routes/rankings"],
];

const mounted = [];
for (const [base, rel] of mounts) {
  const r = loadRoute(rel);
  if (r) {
    app.use(base, r);
    mounted.push({ base, rel });
  }
}
console.log("[router] mounted:", mounted);

/* =======================================================================
   debug routes listing
   ======================================================================= */
function collectRoutes(layer, prefix = "") {
  const out = [];
  if (layer.route && layer.route.path) {
    const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
    out.push({ method: methods.join(","), path: prefix + layer.route.path });
  } else if (layer.name === "router" && layer.handle?.stack) {
    const base = layer.regexp?.fast_slash
      ? ""
      : (layer.regexp?.toString() || "")
          .replace(/^\/\^\\\//, "/")
          .replace(/\\\/\?\(\?=\\\/\|\$\)\/[a-z]*$/, "");
    layer.handle.stack.forEach((l) => out.push(...collectRoutes(l, prefix + base)));
  }
  return out;
}

app.get("/debug/routes", (_req, res) => {
  try {
    const stack = app._router?.stack || [];
    const routes = [];
    stack.forEach((layer) => routes.push(...collectRoutes(layer)));
    res.json({
      ok: true,
      routes: routes
        .filter((r) => r.path)
        .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method)),
      mounted,
      spotifyMounted: SPOTIFY_MOUNTED,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* =======================================================================
   debug db
   ======================================================================= */
app.get("/debug/db", async (_req, res) => {
  try {
    const who = await pool.query(
      "SELECT current_database() AS db, current_schema() AS schema, current_user AS usr"
    );
    const result = { whoami: who.rows[0] };
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* =======================================================================
   404 & 500
   ======================================================================= */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).json({ error: "not found", path: req.originalUrl });
});
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

/* =======================================================================
   start
   ======================================================================= */
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => {
  const base =
    process.env.BACKEND_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${PORT}`;
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] base: ${base}`);
});
