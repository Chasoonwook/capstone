// routes/photos.js
const express = require("express");
const pool = require("../db");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const router = express.Router();

/* =======================
   ENV
======================= */
const USE_ASYNC = process.env.ASYNC_MODE === "1";
const AI_TIMEOUT = Number(process.env.AI_FETCH_TIMEOUT || 60000);
const IMG_TOKEN_TTL = String(process.env.IMG_TOKEN_TTL || "180s");

/* =======================
   Multer (in-memory)
======================= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/* =======================
   Helpers
======================= */
function buildPublicApiBase(req) {
  // 배포 환경에서는 반드시 /api 포함
  return process.env.PUBLIC_API_BASE || `${req.protocol}://${req.get("host")}/api`;
}

async function resolveMood(client, timeLabel, background, emotion, provided) {
  // AI가 이미 mood를 계산해주면 그대로 사용
  if (provided?.main_mood) {
    return {
      main_mood: provided.main_mood,
      sub_mood: provided.sub_mood || provided.mood_sub || null,
    };
  }
  // 1) 완전 일치
  const q1 = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      WHERE time_label = $1 AND background = $2 AND emotion = $3
      LIMIT 1`,
    [timeLabel, background, emotion]
  );
  if (q1.rows[0]) return q1.rows[0];

  // 2) time_label만 일치 (fallback)
  const q2 = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      WHERE time_label = $1
      LIMIT 1`,
    [timeLabel]
  );
  return q2.rows[0] || { main_mood: null, sub_mood: null };
}

async function getRecommendations(client, mainMood, subMood) {
  const main = await client.query(
    `SELECT music_id, title, artist, label, genre
       FROM music
      WHERE label = $1
      ORDER BY created_at DESC
      LIMIT 7`,
    [mainMood]
  );
  const sub = await client.query(
    `SELECT music_id, title, artist, label, genre
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
    [subMood, mainMood]
  );
  return [...main.rows, ...sub.rows];
}

/* =======================
   디버그: 이 라우터가 매칭되는지 확인
   GET /api/photos/_who
======================= */
router.get("/_who", (_req, res) => {
  res.json({ from: "routes/photos.js", analyzePath: "/api/photos/analyze" });
});

/* =======================
   (옵션) 비동기 업로드 목록
======================= */
if (USE_ASYNC) {
  router.post("/upload", upload.single("photo"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tempName = Date.now().toString();
      const { rows } = await client.query(
        `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
         VALUES ($1,$2,$3,$4, now())
         RETURNING photo_id, temp_name, original_name, mime_type, created_at`,
        [tempName, req.file.originalname, req.file.mimetype, req.file.buffer]
      );
      await client.query("COMMIT");
      res.json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Upload failed", detail: e.message });
    } finally {
      client.release();
    }
  });

  router.get("/pending", async (_req, res) => {
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
    } catch (e) {
      res.status(500).json({ error: "Error fetching pending photos" });
    }
  });
}

/* =======================
   바이너리 디버그 (공개)
   GET /api/photos/:photoId/binary
======================= */
router.get("/:photoId/binary", async (req, res) => {
  try {
    const { photoId } = req.params;
    const { rows } = await pool.query(
      "SELECT mime_type, content FROM photos WHERE photo_id=$1",
      [photoId]
    );
    if (!rows.length) return res.status(404).send("Not found");
    res.set("Content-Type", rows[0].mime_type || "application/octet-stream");
    res.send(rows[0].content);
  } catch (e) {
    res.status(500).send("Error");
  }
});

/* =======================
   🔎 임시 디버그: 서명 URL 생성
   GET /api/photos/:photoId/signed-url
   - 테스트 끝나면 삭제/주석 처리 가능
======================= */
router.get("/:photoId/signed-url", (req, res) => {
  try {
    const { photoId } = req.params;
    const token = jwt.sign({ id: String(photoId) }, process.env.IMG_TOKEN_SECRET, {
      expiresIn: String(process.env.IMG_TOKEN_TTL || "180s"),
    });
    const publicApiBase = buildPublicApiBase(req);
    const imageUrl = `${publicApiBase}/images/${photoId}?token=${token}`;
    res.json({ imageUrl, expiresIn: process.env.IMG_TOKEN_TTL || "180s" });
  } catch (e) {
    res.status(500).json({ error: "signed-url failed", detail: e.message });
  }
});

/* =======================
   업로드 → AI → 저장 → 추천 (동기)
   POST /api/photos/analyze
======================= */
router.post("/analyze", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });

    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";
    const { buffer, originalname, mimetype } = req.file;

    await client.query("BEGIN");

    // 1) 사진 저장
    const tempName = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 8);
    const { rows: ins } = await client.query(
      `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
       VALUES ($1,$2,$3,$4, now())
       RETURNING photo_id`,
      [tempName, originalname, mimetype, buffer]
    );
    const photoId = ins[0].photo_id;

    // 2) 서명 URL (AI가 이 URL로 이미지를 읽음)
    const token = jwt.sign({ id: String(photoId) }, process.env.IMG_TOKEN_SECRET, {
      expiresIn: IMG_TOKEN_TTL,
    });
    const publicApiBase = buildPublicApiBase(req);
    const imageUrl = `${publicApiBase}/images/${photoId}?token=${token}`;

    // 3) AI 호출
    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id: photoId, user_id: userId },
      { timeout: AI_TIMEOUT }
    );

    // 4) 파싱(키 호환)
    const timeLabel = ai.time_label || ai.time || null;
    const background = ai.background || ai.scene || ai.category || null;
    const emotion   = ai.emotion   || ai.final_emotion || ai.rule_emotion || null;

    // 5) mood 매핑
    const { main_mood, sub_mood } = await resolveMood(
      client, timeLabel, background, emotion,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    // 6) 분석 저장 (멱등, analyzed_at 사용)
    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())`,
      [photoId, timeLabel, background, emotion, main_mood, sub_mood]
    );

    // 7) 추천 7 + 3
    const recs = await getRecommendations(client, main_mood, sub_mood);

    await client.query("COMMIT");
    return res.json({
      photoId,
      analysis: { time_label: timeLabel, background, emotion, main_mood, sub_mood },
      recommendations: recs,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    // 에러 원인 강제 노출(개발용)
    const raw =
      (err && err.response && err.response.data) ??
      err?.message ??
      err?.toString() ??
      "unknown error";
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    console.error("[analyze FAILED]", { detail, ai_url: `${process.env.AI_BASE_URL}/predict` });
    return res.status(500).json({ error: "analyze failed", detail, from: "routes/photos.js#analyze" });
  } finally {
    client.release();
  }
});

/* =======================
   DB에 이미 있는 사진을 by-id로 분석
   POST /api/photos/:photoId/analyze
======================= */
router.post("/:photoId/analyze", async (req, res) => {
  const client = await pool.connect();
  try {
    const { photoId } = req.params;
    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";

    const exist = await client.query("SELECT 1 FROM photos WHERE photo_id=$1", [photoId]);
    if (!exist.rows.length) return res.status(404).json({ error: "photo not found" });

    await client.query("BEGIN");

    const token = jwt.sign({ id: String(photoId) }, process.env.IMG_TOKEN_SECRET, {
      expiresIn: IMG_TOKEN_TTL,
    });
    const publicApiBase = buildPublicApiBase(req);
    const imageUrl = `${publicApiBase}/images/${photoId}?token=${token}`;

    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id: Number(photoId), user_id: userId },
      { timeout: AI_TIMEOUT }
    );

    const timeLabel = ai.time_label || ai.time || null;
    const background = ai.background || ai.scene || ai.category || null;
    const emotion   = ai.emotion   || ai.final_emotion || ai.rule_emotion || null;

    const { main_mood, sub_mood } = await resolveMood(
      client, timeLabel, background, emotion,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())`,
      [photoId, timeLabel, background, emotion, main_mood, sub_mood]
    );

    await client.query("COMMIT");
    return res.json({
      ok: true,
      photo_id: Number(photoId),
      analysis: { time_label: timeLabel, background, emotion, main_mood, sub_mood },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const raw =
      (err && err.response && err.response.data) ??
      err?.message ??
      err?.toString() ??
      "unknown error";
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    console.error("[analyze by id FAILED]", { detail, ai_url: `${process.env.AI_BASE_URL}/predict` });
    return res.status(500).json({ error: "analyze by id failed", detail, from: "routes/photos.js#byId" });
  } finally {
    client.release();
  }
});

module.exports = router;
