// Backend/server.js
const path = require("path");
const express = require("express");
const cors = require("cors");

// ✅ Backend/.env 경로를 명시적으로 지정 (cwd 영향 제거)
require("dotenv").config({
  path: path.join(__dirname, ".env"),
  debug: true,
});

const pool = require("./db");

const app = express();

/* ─────────────────────────────────────────
 * 기본 설정
 * ───────────────────────────────────────── */
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

/* ─────────────────────────────────────────
 * CORS 설정
 * ───────────────────────────────────────── */
const normalize = (s) => s.replace(/\/+$/, "");
const envList = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(normalize);

const defaultAllow = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://capstone-front-tau.vercel.app",
];

const allowList = envList.length ? envList : defaultAllow;

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    try {
      const url = new URL(origin);
      const norm = normalize(origin);
      if (allowList.includes(norm)) return cb(null, true);
      if (url.hostname.endsWith(".vercel.app")) return cb(null, true);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return cb(null, true);
    } catch {}
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-user-id"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* ─────────────────────────────────────────
 * 헬스체크
 * ───────────────────────────────────────── */
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

/* ─────────────────────────────────────────
 * 안전 로더 (ESM default 대응 + 타입 검증)
 * ───────────────────────────────────────── */
function safeRequire(p) {
  try {
    const mod = require(p);
    const router = (mod && (mod.default || mod)) ?? null;
    if (typeof router !== "function") {
      console.warn(`[router] skip: ${p} (not a function export)`);
      return null;
    }
    console.log(`[router] loaded: ${p}`);
    return router;
  } catch (e) {
    console.warn(`[router] skip: ${p} (${e.code || e.message})`);
    return null;
  }
}

const photoRoutes          = safeRequire("./routes/photos");
const recommendationRoutes = safeRequire("./routes/recommendations");
const imageRoutes          = safeRequire("./routes/images");
const userRoutes           = safeRequire("./routes/users");
const musicRoutes          = safeRequire("./routes/musics");
const authRoutes           = safeRequire("./routes/auth");
const onboardingRoutes     = safeRequire("./routes/onboarding");
const historyRoutes        = safeRequire("./routes/history");
const musicRequestRoutes   = safeRequire("./routes/musicRequests");
const spotifyRoutes        = safeRequire("./routes/spotify"); // ✅

/* ─────────────────────────────────────────
 * 라우터 마운트
 * ───────────────────────────────────────── */
if (photoRoutes)          app.use("/api/photos",           photoRoutes);
if (recommendationRoutes) app.use("/api/recommendations",  recommendationRoutes);
if (imageRoutes)          app.use("/api/images",           imageRoutes);
if (userRoutes)           app.use("/api/users",            userRoutes);
if (musicRoutes)          app.use("/api/musics",           musicRoutes);
if (authRoutes)           app.use("/api/auth",             authRoutes);
if (onboardingRoutes)     app.use("/api",                  onboardingRoutes);
if (historyRoutes)        app.use("/api/history",          historyRoutes);
if (musicRequestRoutes)   app.use("/api/music-requests",   musicRequestRoutes);
if (spotifyRoutes)        app.use("/api/spotify",          spotifyRoutes); // ✅

/* ─────────────────────────────────────────
 * 디버그: 등록 라우트 나열
 * ───────────────────────────────────────── */
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

app.get("/debug/routes", (req, res) => {
  try {
    const stack = app._router?.stack || [];
    const routes = [];
    stack.forEach((layer) => routes.push(...collectRoutes(layer)));
    res.json({
      ok: true,
      version: "routes-v1",
      env: {
        PUBLIC_API_BASE: process.env.PUBLIC_API_BASE || null,
        AI_BASE_URL: process.env.AI_BASE_URL || null,
        // 👇 임시 체크(원하면 지우세요)
        SPOTIFY_ID_SET: !!process.env.SPOTIFY_CLIENT_ID,
        SPOTIFY_SECRET_SET: !!process.env.SPOTIFY_CLIENT_SECRET,
      },
      routes: routes
        .filter((r) => r.path)
        .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method)),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ─────────────────────────────────────────
 * 404 / 에러 핸들러
 * ───────────────────────────────────────── */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).json({ error: "not found", path: req.originalUrl });
});

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

/* ─────────────────────────────────────────
 * 서버 시작
 * ───────────────────────────────────────── */
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
