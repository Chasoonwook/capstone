// Backend/server.js (merged)
const express = require("express");
const cors = require("cors");
require("dotenv").config({ debug: true });
const pool = require("./db");

const app = express();

// ── Proxy 환경(예: Render/NGINX)에서 IP/HTTPS 판별 ──
app.set("trust proxy", 1);

// ── CORS ──
// 우선순위: .env CORS_ORIGIN (콤마 구분) -> 기본 dev 도메인(http://localhost:3000)
const envAllow = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOrigins = envAllow.length ? envAllow : ["http://localhost:3000"];
app.use(cors({ origin: corsOrigins, credentials: true }));

// ── Body Parser ──
app.use(express.json({ limit: "20mb" }));

// ── 루트/헬스체크 ──
app.get("/", (_req, res) => {
  res.send("정상작동");
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.send("Server & Database connection OK");
  } catch (err) {
    console.error("Health check error:", err);
    res.status(500).send("Database connection failed");
  }
});

// ── 라우터 로더(파일 없으면 건너뜀) ──
function safeRequire(path) {
  try {
    return require(path);
  } catch (e) {
    if (e.code === "MODULE_NOT_FOUND") {
      console.warn(`[router] skip: ${path} (not found)`);
      return null;
    }
    // 다른 오류는 그대로 던져서 문제 인지
    throw e;
  }
}

const userRoutes = safeRequire("./routes/users");
const photoRoutes = safeRequire("./routes/photos");
const musicRoutes = safeRequire("./routes/musics");
const recommendationRoutes = safeRequire("./routes/recommendations");
const imageRoutes = safeRequire("./routes/images");          // 네 버전
const aiRoutes = safeRequire("./routes/ai");                 // 팀원 버전
const authRoutes = safeRequire("./routes/auth");             // 팀원 버전
const onboardingRoutes = safeRequire("./routes/onboarding"); // 팀원 버전

if (userRoutes) app.use("/api/users", userRoutes);
if (photoRoutes) app.use("/api/photos", photoRoutes);
if (musicRoutes) app.use("/api/musics", musicRoutes);
if (recommendationRoutes) app.use("/api/recommendations", recommendationRoutes);
if (imageRoutes) app.use("/api/images", imageRoutes);
if (aiRoutes) app.use("/api/ai", aiRoutes);
if (authRoutes) app.use("/api/auth", authRoutes);
if (onboardingRoutes) app.use("/api", onboardingRoutes);

// ── 공통 에러 핸들러 ──
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

// ── 예외 로깅(조용히 죽는 것 방지) ──
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// ── 서버 시작 ──
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
