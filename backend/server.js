// Backend/server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config({ debug: true }); // 디버그 로그 ON
const pool = require("./db");              // ✅ 상대경로: ./db (중요!)

const app = express();

// CORS: 프론트가 http://localhost:3000 이면 이렇게
app.use(cors({ origin: "http://localhost:3000", credentials: true }));

app.use(express.json({ limit: "20mb" }));

// --- 기본 라우트 ---
app.get("/", (req, res) => {
  res.send("정상작동");
});

// --- 헬스체크 (DB도 같이 확인) ---
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.send("Server & Database connection OK");
  } catch (err) {
    console.error("Health check error:", err);
    res.status(500).send("Database connection failed");
  }
});

// --- 라우터 마운트 ---
const userRoutes = require("./routes/users");
const photoRoutes = require("./routes/photos");
const musicRoutes = require("./routes/musics");
const recommendationRoutes = require("./routes/recommendations");
const aiRoutes = require("./routes/ai");
const authRoutes = require("./routes/auth");
const onboardingRoutes = require("./routes/onboarding");

app.use("/api/users", userRoutes);
app.use("/api/photos", photoRoutes);
app.use("/api/musics", musicRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", onboardingRoutes);

// --- 예외 로깅 (조용히 죽는 것 방지) ---
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// --- 서버 시작 ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
