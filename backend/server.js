// server.js
// ----------------------------------------------------
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config({ debug: true });
const pool = require("./db");

const app = express();
app.set("trust proxy", 1);

// ---- parsers
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ======================================================================= */
/* CORS (credentials 허용 + 안정화)                                         */
/* ======================================================================= */
const trim = (s) => (s ? s.replace(/\/+$/, "") : s);
const envAllow = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => trim(s.trim()))
  .filter(Boolean);

// env가 비었을 때만 쓰는 기본 허용 목록
const defaultAllow = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://capstone-front-tau.vercel.app",
]);

function isAllowedOrigin(origin) {
  if (!origin) return true; // 서버-서버 호출 등
  try {
    const url = new URL(origin);
    const norm = trim(origin);
    if (envAllow.length) return envAllow.includes(norm);
    if (defaultAllow.has(norm)) return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  } catch {}
  return false;
}

// 캐시/프록시 안전
app.use((_, res, next) => {
  res.header("Vary", "Origin");
  next();
});

const corsMiddleware = cors({
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // allowedHeaders를 명시하지 않아 브라우저가 보낸 헤더를 자동 허용
  optionsSuccessStatus: 204,
});

app.use(corsMiddleware);
// Express 5에서는 "*"가 에러를 내므로 정규식 사용
app.options(/.*/, corsMiddleware);

/* ======================================================================= */
/* health                                                                  */
/* ======================================================================= */
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

/* ======================================================================= */
/* Spotify 라우터 (가장 먼저 마운트)                                        */
/* ======================================================================= */
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
  console.error("[router] FAILED to mount /api/spotify:", e && (e.stack || e.message || e));
}

// 즉시 진단용 라우트
app.get("/debug/spotify", (_req, res) => {
  res.json({
    mounted: SPOTIFY_MOUNTED,
    file_exists: SPOTIFY_FILE_EXISTS,
    cwd: process.cwd(),
    __dirname,
    env: {
      has_CLIENT_ID: !!process.env.SPOTIFY_CLIENT_ID,
      has_CLIENT_SECRET: !!process.env.SPOTIFY_CLIENT_SECRET,
      REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI || null,
      FRONT_BASE: process.env.FRONT_BASE || null,
    },
  });
});

/* ======================================================================= */
/* 기타 라우터 자동 로더                                                    */
/* ======================================================================= */
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

// ---- mount routers (여기에서만 등록)
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

/* ======================================================================= */
/* debug routes listing                                                     */
/* ======================================================================= */
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

/* ======================================================================= */
/* debug db                                                                 */
/* ======================================================================= */
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

/* ======================================================================= */
/* 404 & 500                                                                */
/* ======================================================================= */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).json({ error: "not found", path: req.originalUrl });
});
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

/* ======================================================================= */
/* start                                                                    */
/* ======================================================================= */
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
