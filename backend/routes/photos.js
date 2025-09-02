// routes/photos.js
const express = require("express");
const pool = require("../db");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const router = express.Router();

const USE_ASYNC = process.env.ASYNC_MODE === "1";
const AI_TIMEOUT = Number(process.env.AI_FETCH_TIMEOUT || 60000);
const IMG_TOKEN_TTL = String(process.env.IMG_TOKEN_TTL || "180s");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/* (선택) 비동기 업로드 라우트 — 필요 없으면 생략 가능 */
if (USE_ASYNC) {
  router.post("/upload", upload.single("photo"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tempName = Date.now().toString();
      const { rows } = await client.query(
        `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
         VALUES ($1,$2,$3,$4, now()) RETURNING photo_id`,
        [tempName, req.file.originalname, req.file.mimetype, req.file.buffer]
      );
      await client.query("COMMIT");
      res.json({ photo_id: rows[0].photo_id });
    } catch (e) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "upload failed", detail: e.message });
    } finally { client.release(); }
  });
}

/* 디버그용 바이너리 응답 */
router.get("/:photoId/binary", async (req, res) => {
  const { photoId } = req.params;
  const { rows } = await pool.query("SELECT mime_type, content FROM photos WHERE photo_id=$1", [photoId]);
  if (!rows.length) return res.status(404).send("Not found");
  res.set("Content-Type", rows[0].mime_type || "application/octet-stream");
  res.send(rows[0].content);
});

/* 공통: mood 매핑/추천 */
async function resolveMood(client, timeLabel, background, emotion, provided) {
  if (provided?.main_mood) return { main_mood: provided.main_mood, sub_mood: provided.sub_mood || null };
  const q1 = await client.query(
    `SELECT main_mood, sub_mood FROM mood_mapping
     WHERE time_label=$1 AND background=$2 AND emotion=$3 LIMIT 1`,
    [timeLabel, background, emotion]
  );
  if (q1.rows[0]) return q1.rows[0];
  const q2 = await client.query(
    `SELECT main_mood, sub_mood FROM mood_mapping
     WHERE time_label=$1 LIMIT 1`,
    [timeLabel]
  );
  return q2.rows[0] || { main_mood: null, sub_mood: null };
}

async function getRecommendations(client, mainMood, subMood) {
  const main = await client.query(
    `SELECT music_id, title, artist, label, genre
     FROM music WHERE label=$1 ORDER BY created_at DESC LIMIT 7`, [mainMood]
  );
  const sub = await client.query(
    `SELECT music_id, title, artist, label, genre
     FROM music WHERE label=$1 AND music_id NOT IN (
       SELECT music_id FROM music WHERE label=$2 ORDER BY created_at DESC LIMIT 7
     )
     ORDER BY created_at DESC LIMIT 3`, [subMood, mainMood]
  );
  return [...main.rows, ...sub.rows];
}

/* 업로드 → AI → 저장 → 추천  */
router.post("/analyze", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });

    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";
    const { buffer, originalname, mimetype } = req.file;

    await client.query("BEGIN");

    // 1) 사진 저장
    const tempName = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 8);
    const ins = await client.query(
      `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
       VALUES ($1,$2,$3,$4, now()) RETURNING photo_id`,
      [tempName, originalname, mimetype, buffer]
    );
    const photoId = ins.rows[0].photo_id;

    // 2) 서명 URL
    const token = jwt.sign({ id: String(photoId) }, process.env.IMG_TOKEN_SECRET, { expiresIn: IMG_TOKEN_TTL });
    const publicApiBase = process.env.PUBLIC_API_BASE || `${req.protocol}://${req.get("host")}/api`;
    const imageUrl = `${publicApiBase}/images/${photoId}?token=${token}`;

    // 3) AI 호출
    const aiResp = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id: photoId, user_id: userId },
      { timeout: AI_TIMEOUT }
    );
    const ai = aiResp.data;

    const timeLabel = ai.time_label || ai.time || null;
    const background = ai.background || ai.scene || null;
    const emotion   = ai.emotion   || ai.face_emotion || null;

    const { main_mood, sub_mood } = await resolveMood(
      client, timeLabel, background, emotion,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    // 4) 분석 저장 (analyzed_at!)
    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())`,
      [photoId, timeLabel, background, emotion, main_mood, sub_mood]
    );

    // 5) 추천
    const recs = await getRecommendations(client, main_mood, sub_mood);

    await client.query("COMMIT");
    return res.json({ photoId, analysis: { time_label: timeLabel, background, emotion, main_mood, sub_mood }, recommendations: recs });
  } catch (err) {
    await client.query("ROLLBACK");
    // ❗원인 파악을 위해 상세 에러 그대로 노출(배포 시엔 로그로만!)
    const detail = err?.response?.data || err.message || String(err);
    console.error("[analyze]", detail);
    return res.status(500).json({ error: "analyze failed", detail });
  } finally { client.release(); }
});

/* ✅ DB에 이미 있는 사진을 by-id로 분석 */
router.post("/:photoId/analyze", async (req, res) => {
  const client = await pool.connect();
  try {
    const { photoId } = req.params;
    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";

    const exists = await client.query("SELECT 1 FROM photos WHERE photo_id=$1", [photoId]);
    if (!exists.rows.length) return res.status(404).json({ error: "photo not found" });

    await client.query("BEGIN");

    const token = jwt.sign({ id: String(photoId) }, process.env.IMG_TOKEN_SECRET, { expiresIn: IMG_TOKEN_TTL });
    const publicApiBase = process.env.PUBLIC_API_BASE || `${req.protocol}://${req.get("host")}/api`;
    const imageUrl = `${publicApiBase}/images/${photoId}?token=${token}`;

    const aiResp = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id: Number(photoId), user_id: userId },
      { timeout: AI_TIMEOUT }
    );
    const ai = aiResp.data;

    const timeLabel = ai.time_label || ai.time || null;
    const background = ai.background || ai.scene || null;
    const emotion   = ai.emotion   || ai.face_emotion || null;

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
    return res.json({ ok: true, photo_id: Number(photoId), analysis: { time_label: timeLabel, background, emotion, main_mood, sub_mood } });
  } catch (err) {
  await client.query("ROLLBACK");
  const detail = err?.response?.data || err.message || String(err);
  console.error("[analyze]", detail);
  res.status(500).json({ error: "analyze failed", detail });
  }
});

module.exports = router;
