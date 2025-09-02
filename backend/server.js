// Backend/server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config({ debug: true });
const pool = require("./db");

const app = express();

/* ── Proxy/HTTPS ── */
app.set("trust proxy", 1);

/* ── CORS ── */
const raw = process.env.CORS_ORIGINS || "";
const normalize = (s) => s.replace(/\/+$/, "");
const envAllow = raw.split(",").map(s => s.trim()).filter(Boolean).map(normalize);
const defaultAllow = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://capstone-front-tau.vercel.app",
];
const allowList = envAllow.length ? envAllow : defaultAllow;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const norm = normalize(origin);
    if (allowList.includes(norm)) return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  } catch (_) {}
  return false;
}

const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  optionsSuccessStatus: 204,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-user-id"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
console.log("[CORS allow list]", allowList);

/* ── Body Parser ── */
app.use(express.json({ limit: "20mb" }));

/* ── 루트/헬스 ── */
app.get("/", (_req, res) => res.send("정상작동"));
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.send("Server & Database connection OK");
  } catch (err) {
    console.error("Health check error:", err);
    res.status(500).send("Database connection failed");
  }
});

/* ── 라우터 로더 ── */
function safeRequire(path) {
  try {
    const mod = require(path);
    console.log(`[router] loaded: ${path}`);
    return mod;
  } catch (e) {
    if (e.code === "MODULE_NOT_FOUND") {
      console.warn(`[router] skip: ${path} (not found)`);
      return null;
    }
    console.error(`[router] error: ${path}`, e);
    return null;
  }
}

const userRoutes = safeRequire("./routes/users");
const photoRoutes = safeRequire("./routes/photos");
const musicRoutes = safeRequire("./routes/musics");
const recommendationRoutes = safeRequire("./routes/recommendations");
const imageRoutes = safeRequire("./routes/images");
const aiRoutes = safeRequire("./routes/ai");
const authRoutes = safeRequire("./routes/auth");
const onboardingRoutes = safeRequire("./routes/onboarding");
const historyRoutes = safeRequire("./routes/history");

if (userRoutes) app.use("/api/users", userRoutes);
if (photoRoutes) app.use("/api/photos", photoRoutes);
if (musicRoutes) app.use("/api/musics", musicRoutes);
if (recommendationRoutes) app.use("/api/recommendations", recommendationRoutes);
if (imageRoutes) app.use("/api/images", imageRoutes);
if (aiRoutes) app.use("/api/ai", aiRoutes);
if (authRoutes) app.use("/api/auth", authRoutes);
if (onboardingRoutes) app.use("/api", onboardingRoutes);
if (historyRoutes) app.use("/api/history", historyRoutes);

/* ── 404/에러 핸들러 ── */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  return res.status(404).json({ error: "not found", path: req.originalUrl });
});
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

/* ── 서버 시작 ── */
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
