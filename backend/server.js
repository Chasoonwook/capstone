// Backend/server.js
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

/* ── dotenv: 현재 파일(서버) 디렉터리의 .env를 명시적으로 로드 ── */
require("dotenv").config({
  path: path.join(__dirname, ".env"),
  debug: true,
});

const pool = require("./db");
const app = express();

/* ─────────────────────────────────────────
 * 부팅 로그(배포 문제 원인 파악용)
 * ───────────────────────────────────────── */
console.log("[boot] cwd=", process.cwd(), " __dirname=", __dirname);
const ROUTES_DIR = path.join(__dirname, "routes");
console.log("[boot] routes dir exists:", fs.existsSync(ROUTES_DIR));

/* ─────────────────────────────────────────
 * 기본 설정
 * ───────────────────────────────────────── */
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

/* ─────────────────────────────────────────
 * CORS
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
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With","x-user-id"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* ─────────────────────────────────────────
 * 헬스체크
 * ───────────────────────────────────────── */
app.get("/", (_req, res) => res.send("정상작동"));
app.get("/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.send("Server & Database connection OK"); }
  catch (e) { console.error(e); res.status(500).send("Database connection failed"); }
});

/* ─────────────────────────────────────────
 * 안전 로더(절대경로 + 상세로그)
 * ───────────────────────────────────────── */
function loadRoute(relPath) {
  try {
    const abs = path.join(__dirname, relPath);
    if (!fs.existsSync(abs) && !fs.existsSync(abs + ".js")) {
      console.warn(`[router] skip: ${relPath} (file not found) abs=${abs}`);
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

/* ─────────────────────────────────────────
 * 라우터 마운트
 * ───────────────────────────────────────── */
const mounts = [
  ["/api/photos",          "routes/photos"],
  ["/api/recommendations", "routes/recommendations"],
  ["/api/images",          "routes/images"],
  ["/api/users",           "routes/users"],
  ["/api/musics",          "routes/musics"],
  ["/api/auth",            "routes/auth"],
  ["/api",                 "routes/onboarding"],
  ["/api/history",         "routes/history"],
  ["/api/music-requests",  "routes/musicRequests"],
  ["/api/spotify",         "routes/spotify"],       // ✅ 여기!
];

const mounted = [];
for (const [base, rel] of mounts) {
  const r = loadRoute(rel);
  if (r) { app.use(base, r); mounted.push({ base, rel }); }
}
console.log("[router] mounted:", mounted);

/* ─────────────────────────────────────────
 * 디버그: 등록 라우트/환경
 * ───────────────────────────────────────── */
function collectRoutes(layer, prefix = "") {
  const out = [];
  if (layer.route && layer.route.path) {
    const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
    out.push({ method: methods.join(","), path: prefix + layer.route.path });
  } else if (layer.name === "router" && layer.handle?.stack) {
    const base =
      layer.regexp?.fast_slash
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
        SPOTIFY_ID_SET: !!process.env.SPOTIFY_CLIENT_ID,
        SPOTIFY_SECRET_SET: !!process.env.SPOTIFY_CLIENT_SECRET,
        cwd: process.cwd(),
        dirname: __dirname,
        routesDirExists: fs.existsSync(ROUTES_DIR),
      },
      mounted,
      routes: routes
        .filter((r) => r.path)
        .sort((a,b)=> (a.path+a.method).localeCompare(b.path+b.method)),
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

/* ─────────────────────────────────────────
 * 404 / Error
 * ───────────────────────────────────────── */
app.use((req, res, next) => { if (res.headersSent) return next(); res.status(404).json({ error: "not found", path: req.originalUrl }); });
app.use((err, _req, res, _next) => { console.error("[error]", err); res.status(500).json({ error: "internal error" }); });

/* ─────────────────────────────────────────
 * Start
 * ───────────────────────────────────────── */
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
