// server.js
// ----------------------------------------------------
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config({ debug: true });
const pool = require("./db");
const spotifyRoutes = require('./routes/spotify');

const app = express();
app.set("trust proxy", 1);

// ---- parsers
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- CORS (credentials 허용)
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
    "x-preferred-genres",
  ],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// ---- health
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

// ---- router loader
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

app.use('/api/spotify', spotifyRoutes);

// ---- mount routers (여기에서만 등록)
const mounts = [
  ["/api/photos", "routes/photos"],
  ["/api/recommendations", "routes/recommendations"],
  ["/api/images", "routes/images"],
  ["/api/users", "routes/users"],       // ← /users/me 가 이 라우터에 있어야 함
  ["/api/musics", "routes/musics"],
  ["/api/auth", "routes/auth"],         // ← /auth/login, /auth/register, /auth/me
  ["/api", "routes/onboarding"],
  ["/api/history", "routes/history"],
  ["/api/music-requests", "routes/musicRequests"],
  ["/api", "routes/feedback"],
  ["/api", "routes/stickers"],
  ["/api/diaries", "routes/diaries"],   // ★ 추가: 그림일기 라우트
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

// ---- debug routes
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
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- debug db
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

// ---- 404 & 500
app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).json({ error: "not found", path: req.originalUrl });
});
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

// ---- start
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
