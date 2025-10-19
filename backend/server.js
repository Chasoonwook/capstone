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
