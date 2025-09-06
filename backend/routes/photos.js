const express = require("express");
const pool = require("../db");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const router = express.Router();

/** ---- ENV / 기본 설정 ---- */
const USE_ASYNC = process.env.ASYNC_MODE === "1"; // (현재는 사용 안함)
const AI_TIMEOUT = Number(process.env.AI_FETCH_TIMEOUT || 60_000);
const IMG_TOKEN_TTL = String(process.env.IMG_TOKEN_TTL || "600s");

/** 업로드: 메모리 저장(최대 20MB) */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** PUBLIC_API_BASE 계산 (env 우선, 없으면 요청 기준) */
function apiBase(req) {
  const envBase = process.env.PUBLIC_API_BASE;
  if (envBase) return envBase.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}/api`;
}

/** ---- 유틸: mood 매핑 ---- */
async function resolveMood(client, timeLabel, background, emotion, prefer) {
  if (prefer?.main_mood) {
    return {
      main_mood: prefer.main_mood,
      sub_mood: prefer.sub_mood || prefer.mood_sub || null,
    };
  }
  // 1순위: 시간+배경+감정
  const q1 = await client.query(
    `SELECT main_mood, sub_mood
     FROM mood_mapping
     WHERE time_label=$1 AND background=$2 AND emotion=$3
     LIMIT 1`,
    [timeLabel, background, emotion]
  );
  if (q1.rows[0]) return q1.rows[0];

  // 2순위: 시간만
  const q2 = await client.query(
    `SELECT main_mood, sub_mood
     FROM mood_mapping
     WHERE time_label=$1
     LIMIT 1`,
    [timeLabel]
  );
  return q2.rows[0] || { main_mood: null, sub_mood: null };
}

/** ---- 유틸: 추천 7+3 ---- */
async function fetchRecs(client, main, sub) {
  const a = (
    await client.query(
      `SELECT music_id, title, artist, label, genre
       FROM music
       WHERE label=$1
       ORDER BY created_at DESC
       LIMIT 7`,
      [main]
    )
  ).rows;
  const b = (
    await client.query(
      `SELECT music_id, title, artist, label, genre
       FROM music
       WHERE label=$1
         AND music_id NOT IN (
           SELECT music_id FROM music WHERE label=$2 ORDER BY created_at DESC LIMIT 7
         )
       ORDER BY created_at DESC
       LIMIT 3`,
      [sub, main]
    )
  ).rows;
  return [...a, ...b];
}

/** ----------------------------------------
 *  디버그
 * -------------------------------------- */
router.get("/_who", (_req, res) =>
  res.json({ from: "routes/photos.js", analyzePath: "/api/photos/analyze" })
);

/** ----------------------------------------
 *  퍼블릭 바이너리 (디버그용)
 *  - 스키마가 photo_id 또는 id 인 경우 모두 대응
 * -------------------------------------- */
router.get("/:photoId/binary", async (req, res) => {
  try {
    const { photoId } = req.params;
    const r = await pool.query(
      `SELECT mime_type, content
       FROM photos
       WHERE photo_id = $1 OR id = $1
       LIMIT 1`,
      [photoId]
    );
    if (!r.rows.length) return res.status(404).send("Not found");
    res.set("Content-Type", r.rows[0].mime_type || "application/octet-stream");
    res.send(r.rows[0].content);
  } catch (e) {
    console.error("[photos/binary] error:", e);
    res.status(500).send("Error");
  }
});

/** ----------------------------------------
 *  서명 URL 발급 (AI용)
 * -------------------------------------- */
router.get("/:photoId/signed-url", (req, res) => {
  try {
    const { photoId } = req.params;
    const token = jwt.sign(
      { id: String(photoId) },
      process.env.IMG_TOKEN_SECRET,
      { expiresIn: IMG_TOKEN_TTL }
    );
    const imageUrl = `${apiBase(req)}/images/${photoId}?token=${token}`;
    res.json({ imageUrl, expiresIn: IMG_TOKEN_TTL });
  } catch (e) {
    console.error("[photos/signed-url] error:", e);
    res
      .status(500)
      .json({ error: "signed-url failed", detail: e?.message || String(e) });
  }
});

/** ----------------------------------------
 *  업로드 + 즉시 분석
 *  - 필드명: file (프론트/테스트 curl과 일치)
 *  - AI에는 반드시 '서명 URL'을 전달
 * -------------------------------------- */
router.post("/analyze", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });

    const userId =
      req.body.userId || "00000000-0000-0000-0000-000000000000";
    const { buffer, originalname, mimetype } = req.file;

    await client.query("BEGIN");

    const temp = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex")
      .slice(0, 8);

    const ins = await client.query(
      `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING photo_id`,
      [temp, originalname, mimetype, buffer]
    );
    const photoId = ins.rows[0].photo_id;

    // 1) 서명 URL 발급
    const token = jwt.sign(
      { id: String(photoId) },
      process.env.IMG_TOKEN_SECRET,
      { expiresIn: IMG_TOKEN_TTL }
    );
    const imageUrl = `${apiBase(req)}/images/${photoId}?token=${token}`;

    // 2) AI 호출 (문자열 형식으로 전달)
    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      {
        image_url: imageUrl,
        photo_id: String(photoId),
        user_id: String(userId),
      },
      { timeout: AI_TIMEOUT }
    );

    // 3) 결과 파싱
    const time = ai.time_label || ai.time || null;
    const back = ai.background || ai.scene || ai.category || null;
    const emo = ai.emotion || ai.final_emotion || ai.rule_emotion || null;

    const { main_mood, sub_mood } = await resolveMood(
      client,
      time,
      back,
      emo,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    // 4) 저장
    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [
      photoId,
    ]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [photoId, time, back, emo, main_mood, sub_mood]
    );

    const items = await fetchRecs(client, main_mood, sub_mood);

    await client.query("COMMIT");
    res.json({
      photoId,
      analysis: {
        time_label: time,
        background: back,
        emotion: emo,
        main_mood,
        sub_mood,
      },
      recommendations: items,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const raw =
      (err && err.response && err.response.data) ||
      err?.message ||
      err?.toString() ||
      "unknown error";
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    console.error("[analyze FAILED]", {
      detail,
      ai_url: `${process.env.AI_BASE_URL}/predict`,
    });
    res
      .status(500)
      .json({
        error: "analyze failed",
        detail,
        from: "routes/photos.js#analyze",
      });
  } finally {
    client.release();
  }
});

/** ----------------------------------------
 *  기존 사진 id로만 재분석
 * -------------------------------------- */
router.post("/:photoId/analyze", async (req, res) => {
  const client = await pool.connect();
  try {
    const { photoId } = req.params;
    const userId =
      req.body.userId || "00000000-0000-0000-0000-000000000000";

    const ex = await client.query(
      `SELECT 1 FROM photos WHERE photo_id=$1 OR id=$1`,
      [photoId]
    );
    if (!ex.rows.length)
      return res.status(404).json({ error: "photo not found" });

    await client.query("BEGIN");

    const token = jwt.sign(
      { id: String(photoId) },
      process.env.IMG_TOKEN_SECRET,
      { expiresIn: IMG_TOKEN_TTL }
    );
    const imageUrl = `${apiBase(req)}/images/${photoId}?token=${token}`;

    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      {
        image_url: imageUrl,
        photo_id: String(photoId),
        user_id: String(userId),
      },
      { timeout: AI_TIMEOUT }
    );

    const time = ai.time_label || ai.time || null;
    const back = ai.background || ai.scene || ai.category || null;
    const emo = ai.emotion || ai.final_emotion || ai.rule_emotion || null;

    const { main_mood, sub_mood } = await resolveMood(
      client,
      time,
      back,
      emo,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [
      photoId,
    ]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [photoId, time, back, emo, main_mood, sub_mood]
    );

    await client.query("COMMIT");
    res.json({
      ok: true,
      photo_id: Number(photoId),
      analysis: {
        time_label: time,
        background: back,
        emotion: emo,
        main_mood,
        sub_mood,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    const raw =
      (err && err.response && err.response.data) ||
      err?.message ||
      err?.toString() ||
      "unknown error";
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    console.error("[analyze by id FAILED]", {
      detail,
      ai_url: `${process.env.AI_BASE_URL}/predict`,
    });
    res
      .status(500)
      .json({
        error: "analyze by id failed",
        detail,
        from: "routes/photos.js#byId",
      });
  } finally {
    client.release();
  }
});

module.exports = router;
