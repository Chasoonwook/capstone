// server.js (merged)
// ----------------------------------------------------
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
require("dotenv").config({ debug: true }); // Render/환경변수 우선. 로컬 .env도 자동 탐지
const pool = require("./db");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

/* ---------------------------
 * CORS
 * ------------------------- */
const normalize = (s) => (s ? s.replace(/\/+$/, "") : s);
const envAllow = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(normalize);

const defaultAllow = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://capstone-front-tau.vercel.app",
];

const allowList = envAllow.length ? envAllow : defaultAllow;

const corsOptions = {
  origin(origin, cb) {
    // 서버-서버/포스트맨/크론 등 Origin 없는 요청 허용
    if (!origin) return cb(null, true);
    try {
      const url = new URL(origin);
      const norm = normalize(origin);
      if (allowList.includes(norm)) return cb(null, true);
      if (url.hostname.endsWith(".vercel.app")) return cb(null, true);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
        return cb(null, true);
    } catch {}
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type", 
    "Authorization", 
    "X-Requested-With", 
    "x-user-id",
    "x-preferred-genres"
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// 모든 경로에 대해 사전검사(Preflight) 허용
app.options(/.*/, cors(corsOptions));


/* ---------------------------
 * Health
 * ------------------------- */
app.get("/", (_req, res) => res.send("정상작동"));
app.get("/health", async (_req, res) => {
  try {
    // DB 연결 확인
    await pool.query("SELECT 1");
    res.send("Server & Database connection OK");
  } catch (e) {
    console.error(e);
    res.status(500).send("Database connection failed");
  }
});

/* ---------------------------
 * 라우터 안전 로더 (절대경로 확인)
 * ------------------------- */
function loadRoute(relPath) {
  try {
    const abs = path.join(__dirname, relPath);
    // 파일 존재 여부 체크 (.js 확장자까지 고려)
    if (!fs.existsSync(abs) && !fs.existsSync(abs + ".js")) {
      console.warn(`[router] skip: ${relPath} (not found) abs=${abs}`);
      return null;
    }
    const mod = require(abs);
    // CommonJS/ESM 호환
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

/* ---------------------------
 * 실제 마운트 (중복 방지: 여기서만 등록)
 * ------------------------- */
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
  ["/api/spotify",         "routes/spotify"], // ✅ 팀원 코드의 핵심 라우터 포함
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

/* ---------------------------
 * /debug/routes : 현재 등록된 라우트 나열
 * ------------------------- */
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
          .replace(/\\\/\?\(\?=\\\/\|\$\)\/[a-z]*$/, ""); // 팀원 버전의 보다 안전한 패턴
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
      version: "routes-v1",
      env: {
        PUBLIC_API_BASE: process.env.PUBLIC_API_BASE,
        AI_BASE_URL: process.env.AI_BASE_URL,
        SPOTIFY_ID_SET: !!process.env.SPOTIFY_CLIENT_ID,
        SPOTIFY_SECRET_SET: !!process.env.SPOTIFY_CLIENT_SECRET,
        cwd: process.cwd(),
        dirname: __dirname,
        routesDirExists: fs.existsSync(path.join(__dirname, "routes")),
      },
      mounted,
      routes: routes
        .filter((r) => r.path)
        .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method)),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------
 * /debug/db : 현재 DB/스키마 점검(선택)
 * ------------------------- */
app.get("/debug/db", async (_req, res) => {
  try {
    const url = process.env.DATABASE_URL || "(no env)";
    const who = await pool.query(
      "SELECT current_database() AS db, current_schema() AS schema, current_user AS usr"
    );
    const cols = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'photo_analysis'
      ORDER BY ordinal_position
    `);
    res.json({
      DATABASE_URL: url,
      whoami: who.rows[0],
      photo_analysis_columns: cols.rows.map((r) => r.column_name),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ---------------------------
 * 공통 404 / 500
 * ------------------------- */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).json({ error: "not found", path: req.originalUrl });
});

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

/* ---------------------------
 * Start
 * ------------------------- */
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
