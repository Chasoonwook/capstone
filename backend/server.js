// server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config({ debug: true });
const pool = require("./db");

const app = express();
app.set("trust proxy", 1);

// ----- CORS -----
const raw = process.env.CORS_ORIGINS || "";
const normalize = (s) => s.replace(/\/+$/, "");
const envAllow = raw.split(",").map(s => s.trim()).filter(Boolean).map(normalize);
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
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return cb(null, true);
    } catch {}
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  optionsSuccessStatus: 204,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With","x-user-id"],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "20mb" }));

// ----- Health -----
app.get("/", (_req, res) => res.send("정상작동"));
app.get("/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.send("Server & Database connection OK"); }
  catch (e) { console.error(e); res.status(500).send("Database connection failed"); }
});

// ----- Safe require + mount -----
function safeRequire(p) {
  try { const m = require(p); console.log(`[router] loaded: ${p}`); return m; }
  catch (e) { console.warn(`[router] skip: ${p} (${e.code || e.message})`); return null; }
}

const photoRoutes = safeRequire("./routes/photos");
const recommendationRoutes = safeRequire("./routes/recommendations");
const imageRoutes = safeRequire("./routes/images");
const userRoutes = safeRequire("./routes/users");
const musicRoutes = safeRequire("./routes/musics");
const authRoutes = safeRequire("./routes/auth");
const onboardingRoutes = safeRequire("./routes/onboarding");
const historyRoutes = safeRequire("./routes/history");

// ⚠️ 라우터는 전부 여기서만 마운트 (server.js에 개별 엔드포인트 절대 X)
if (photoRoutes) app.use("/api/photos", photoRoutes);
if (recommendationRoutes) app.use("/api/recommendations", recommendationRoutes);
if (imageRoutes) app.use("/api/images", imageRoutes);
if (userRoutes) app.use("/api/users", userRoutes);
if (musicRoutes) app.use("/api/musics", musicRoutes);
if (authRoutes) app.use("/api/auth", authRoutes);
if (onboardingRoutes) app.use("/api", onboardingRoutes);
if (historyRoutes) app.use("/api/history", historyRoutes);

// ----- 🔎 디버그: 등록 라우트 전체 나열 -----
function collectRoutes(layer, prefix = "") {
  const out = [];
  if (layer.route && layer.route.path) {
    const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
    out.push({ method: methods.join(","), path: prefix + layer.route.path });
  } else if (layer.name === "router" && layer.handle.stack) {
    layer.handle.stack.forEach(l => out.push(...collectRoutes(l, prefix + (layer.regexp?.fast_slash ? "" : layer.regexp?.toString().replace(/^\/\^\\\//,"/").replace(/\\\/\?\(\?=\\\/\|\$\)\/i$/,"") || ""))));
  }
  return out;
}
app.get("/debug/routes", (req, res) => {
  try {
    const stack = app._router?.stack || [];
    const routes = [];
    stack.forEach(layer => { routes.push(...collectRoutes(layer)); });
    res.json({
      ok: true,
      version: "routes-v1",
      env: {
        PUBLIC_API_BASE: process.env.PUBLIC_API_BASE,
        AI_BASE_URL: process.env.AI_BASE_URL,
      },
      routes: routes
        .filter(r => r.path)               // only real routes
        .sort((a,b)=> (a.path+b.method).localeCompare(b.path+b.method)),
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ----- 404 / Error -----
app.use((req, res, next) => { if (res.headersSent) return next(); res.status(404).json({ error: "not found", path: req.originalUrl }); });
app.use((err, _req, res, _next) => { console.error("[error]", err); res.status(500).json({ error: "internal error" }); });

// ----- Start -----
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
