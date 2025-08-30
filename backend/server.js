// Backend/server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config({ debug: true });
const pool = require("./db");
const multer = require("multer"); // 파일 업로드용
const crypto = require("crypto"); // temp_name 해시용

const app = express();

//env route resot


/* ── Proxy/HTTPS 환경 ── */
app.set("trust proxy", 1);

/* ── CORS ──
   우선순위: .env의 CORS_ORIGIN(콤마 구분) → 기본 http://localhost:3000 */
const envAllow = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const corsOrigins = envAllow.length ? envAllow : ["http://localhost:3000"];
app.use(cors({ origin: corsOrigins, credentials: true }));

/* ── Body Parser ── */
app.use(express.json({ limit: "20mb" }));
// app.use(express.urlencoded({ extended: true, limit: "20mb" }));

/* ── 루트/헬스체크 ── */
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

/* ── 라우터 로더(파일 없으면 건너뜀) ── */
function safeRequire(path) {
  try {
    return require(path);
  } catch (e) {
    if (e.code === "MODULE_NOT_FOUND") {
      console.warn(`[router] skip: ${path} (not found)`);
      return null;
    }
    throw e;
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

if (userRoutes) app.use("/api/users", userRoutes);
if (photoRoutes) app.use("/api/photos", photoRoutes);
if (musicRoutes) app.use("/api/musics", musicRoutes);
if (recommendationRoutes) app.use("/api/recommendations", recommendationRoutes);
if (imageRoutes) app.use("/api/images", imageRoutes);
if (aiRoutes) app.use("/api/ai", aiRoutes);
if (authRoutes) app.use("/api/auth", authRoutes);
if (onboardingRoutes) app.use("/api", onboardingRoutes);

/* ────────────────────────────────────────────────────────────────
 * Backup/기본 구현 핸들러 (routes에 동일 경로가 있으면 그쪽이 우선)
 *  - [1] 업로드 → DB photos 저장 + photo_id 반환
 *  - [3] AI 결과 수신 → photo_analysis 저장 (mood_mapping 보정)
 *  - [3] 대기목록/바이너리 제공
 *  - [4] 사진기반 추천 7+3
 * ──────────────────────────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

/** [1] 업로드: POST /api/photos/upload
 *  - formData.append("photo", file)
 *  - DB: photos(temp_name, original_name, mime_type, content, created_at)
 *  - 응답: { photo_id }
 */
// server.js (일부만 수정)
app.post("/api/photos/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });

    const { buffer, originalname, mimetype } = req.file;

    // 기존 해시 → 교체
    // const tempName = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 8);

    // 새로운 UUID 기반 temp_name
    const tempName = crypto.randomUUID();  

    const { rows } = await pool.query(
      `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
       VALUES ($1,$2,$3,$4, now())
       RETURNING photo_id`,
      [tempName, originalname, mimetype, buffer]
    );

    return res.json({ photo_id: rows[0].photo_id });
  } catch (e) {
    console.error("upload error:", e);
    return res.status(500).json({ error: "upload failed" });
  }
});



/** [3] 미분석 목록: GET /api/photos/pending
 *  - photo_analysis에 아직 없는 사진들 50개
 */
app.get("/api/photos/pending", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.photo_id, p.temp_name, p.original_name, p.mime_type, p.created_at
         FROM photos p
         LEFT JOIN photo_analysis a ON a.photo_id = p.photo_id
        WHERE a.photo_id IS NULL
        ORDER BY p.created_at ASC
        LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error("[pending]", err.message);
    res.status(500).json({ error: "pending failed" });
  }
});

/** [3] 바이너리 제공: GET /api/photos/:photoId/binary
 *  - DB bytea → 바이너리 직접 응답
 */
app.get("/api/photos/:photoId/binary", async (req, res) => {
  try {
    const { photoId } = req.params;
    const { rows } = await pool.query(
      "SELECT mime_type, content FROM photos WHERE photo_id = $1",
      [photoId]
    );
    if (!rows[0]) return res.status(404).send("Not found");
    res.set("Content-Type", rows[0].mime_type || "application/octet-stream");
    res.send(rows[0].content);
  } catch (err) {
    console.error("[binary]", err.message);
    res.status(500).send("Error");
  }
});

/** [3] AI 결과 수신: POST /api/ai/results
 *  body: { photo_id, user_id?, time_label?, background?, emotion?, main_mood?, sub_mood? }
 *  - mood_mapping으로 보정 후 photo_analysis 멱등 저장
 */
app.post("/api/ai/results", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      photo_id,
      user_id = "00000000-0000-0000-0000-000000000000",
      time_label = null,
      background = null,
      emotion = null,
      main_mood = null,
      sub_mood = null,
    } = req.body || {};

    if (!photo_id) return res.status(400).json({ error: "photo_id required" });

    await client.query("BEGIN");

    // 무드 보정
    let finalMain = main_mood;
    let finalSub  = sub_mood;

    if (!finalMain) {
      const { rows } = await client.query(
        `SELECT main_mood, sub_mood
           FROM mood_mapping
          WHERE ($1::text IS NULL OR time_label = $1)
            AND ($2::text IS NULL OR background = $2)
            AND ($3::text IS NULL OR emotion = $3)
          LIMIT 1`,
        [time_label, background, emotion]
      );
      if (rows[0]) {
        finalMain = rows[0].main_mood;
        finalSub  = rows[0].sub_mood;
      }
    }

    // 멱등 저장
    await client.query(`DELETE FROM photo_analysis WHERE photo_id = $1`, [photo_id]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())`,
      [photo_id, time_label, background, emotion, finalMain, finalSub]
    );

    await client.query("COMMIT");
    res.json({ ok: true, photo_id, main_mood: finalMain, sub_mood: finalSub });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[ai/results]", err.message);
    res.status(500).json({ error: "ai results failed" });
  } finally {
    client.release();
  }
});

/** [4] 사진기반 추천: GET /api/recommendations/by-photo/:photoId
 *  - photo_analysis에서 main/sub 읽고
 *  - music에서 메인 7 + 서브 3(중복제거) 반환
 */
app.get("/api/recommendations/by-photo/:photoId", async (req, res) => {
  const { photoId } = req.params;
  try {
    const { rows: aRows } = await pool.query(
      `SELECT main_mood, sub_mood
         FROM photo_analysis
        WHERE photo_id = $1
        LIMIT 1`,
      [photoId]
    );

    // 아직 분석이 안 됐으면 202 Accepted로 "대기중" 신호
    if (aRows.length === 0) {
      return res.status(202).json({ pending: true, photo_id: Number(photoId) });
    }

    const { main_mood, sub_mood } = aRows[0];
    if (!main_mood && !sub_mood) {
      return res.status(409).json({ error: "Mood mapping missing" });
    }

    const { rows: mainSongs } = await pool.query(
      `SELECT music_id, title, artist, label AS genre
         FROM music
        WHERE label = $1
        ORDER BY created_at DESC
        LIMIT 7`,
      [main_mood]
    );

    const { rows: subSongs } = await pool.query(
      `SELECT music_id, title, artist, label AS genre
         FROM music
        WHERE label = $1
          AND music_id NOT IN (
            SELECT music_id FROM music
             WHERE label = $2
             ORDER BY created_at DESC
             LIMIT 7
          )
        ORDER BY created_at DESC
        LIMIT 3`,
      [sub_mood || main_mood, main_mood]
    );

    return res.json({
      main_mood,
      sub_mood,
      main_songs: mainSongs,
      sub_songs: subSongs,
    });
  } catch (err) {
    console.error("[recommend/by-photo]", err.message);
    res.status(500).json({ error: "recommendation failed" });
  }
});


/* ── 404 JSON (HTML 대신 JSON으로 통일) ── */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  return res.status(404).json({ error: "not found", path: req.originalUrl });
});

/* ── 공통 에러 핸들러 ── */
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

/* ── 서버 시작 ── */
const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});