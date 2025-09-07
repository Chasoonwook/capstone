// routes/photos.js
const express = require("express");
const pool = require("../db");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const router = express.Router();

const AI_TIMEOUT    = Number(process.env.AI_FETCH_TIMEOUT || 60_000);
const IMG_TOKEN_TTL = String(process.env.IMG_TOKEN_TTL || "600s");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function apiBase(req) {
  const envBase = process.env.PUBLIC_API_BASE;
  if (envBase) return envBase.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}/api`;
}

/* ── mood 매핑: 소문자/trim + 점진 매칭 ─────────────────────────── */
async function resolveMood(client, timeLabel, background, emotion, prefer) {
  if (prefer?.main_mood) {
    return {
      main_mood: prefer.main_mood,
      sub_mood: prefer.sub_mood || prefer.mood_sub || null,
    };
  }
  const t = (timeLabel  || "").trim().toLowerCase();
  const b = (background || "").trim().toLowerCase();
  const e = (emotion    || "").trim().toLowerCase();

  let q = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      WHERE LOWER(TRIM(time))       = $1
        AND LOWER(TRIM(background)) = $2
        AND LOWER(TRIM(emotion))    = $3
      LIMIT 1`, [t,b,e]
  );
  if (q.rows[0]) return q.rows[0];

  q = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      WHERE LOWER(TRIM(time))       = $1
        AND LOWER(TRIM(background)) = $2
      ORDER BY mapping_id
      LIMIT 1`, [t,b]
  );
  if (q.rows[0]) return q.rows[0];

  q = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      WHERE LOWER(TRIM(time)) = $1
      ORDER BY mapping_id
      LIMIT 1`, [t]
  );
  if (q.rows[0]) return q.rows[0];

  q = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      ORDER BY mapping_id
      LIMIT 1`
  );
  return q.rows[0] || { main_mood:null, sub_mood:null };
}

/* 추천 7+3 */
async function fetchRecs(client, main, sub) {
  const a = (await client.query(
    `SELECT music_id, title, artist, label, genre
       FROM music
      WHERE label=$1
      ORDER BY created_at DESC
      LIMIT 7`, [main]
  )).rows;

  const b = (await client.query(
    `SELECT music_id, title, artist, label, genre
       FROM music
      WHERE label=$1
        AND music_id NOT IN (
          SELECT music_id FROM music WHERE label=$2 ORDER BY created_at DESC LIMIT 7
        )
      ORDER BY created_at DESC
      LIMIT 3`, [sub, main]
  )).rows;

  return [...a, ...b];
}

/* 디버그 */
router.get("/_who", (_req,res) =>
  res.json({ from:"routes/photos.js", analyzePath:"/api/photos/analyze" })
);

/* 디버그용 바이너리 */
router.get("/:photoId/binary", async (req,res)=>{
  try {
    const { photoId } = req.params;
    const r = await pool.query(
      "SELECT mime_type, content FROM photos WHERE photo_id=$1", [photoId]
    );
    if (!r.rows.length) return res.status(404).send("Not found");
    res.set("Content-Type", r.rows[0].mime_type || "application/octet-stream");
    res.send(r.rows[0].content);
  } catch (e) {
    console.error("[photos/binary] error:", e);
    res.status(500).send("Error");
  }
});

/* 서명 URL 발급 */
router.get("/:photoId/signed-url", (req,res)=>{
  try {
    const { photoId } = req.params;
    const token = jwt.sign({ id:String(photoId) }, process.env.IMG_TOKEN_SECRET, { expiresIn: IMG_TOKEN_TTL });
    const imageUrl = `${apiBase(req)}/images/${photoId}?token=${token}`;
    res.json({ imageUrl, expiresIn: IMG_TOKEN_TTL });
  } catch (e) {
    console.error("[photos/signed-url] error:", e);
    res.status(500).json({ error:"signed-url failed", detail: e?.message || String(e) });
  }
});

/* 내부 유틸: 이미지가 실제로 200 나오는지 짧게 확인 (최대 5회, 80ms 간격) */
async function waitImageVisible(imageUrl) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await axios.get(imageUrl, {
        responseType: "stream",
        validateStatus: () => true, // 404 등도 throw하지 않게
      });
      if (r.status === 200) {
        // 스트림 닫기 (누수 방지)
        if (r.data && typeof r.data.destroy === "function") r.data.destroy();
        return true;
      }
      if (r.data && typeof r.data.destroy === "function") r.data.destroy();
    } catch (_) {
      // 무시하고 재시도
    }
    await new Promise(res => setTimeout(res, 80)); // 80ms 간격, 총 5회
  }
  return false;
}

/* 업로드 + 즉시 분석 (두 단계 COMMIT) */
router.post("/analyze", upload.single("file"), async (req,res)=>{
  let imageUrl;
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error:"no file" });
    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";
    const { buffer, originalname, mimetype } = req.file;

    /* 1) 사진 저장 트랜잭션 —> COMMIT 먼저 */
    await client.query("BEGIN");
    const temp = crypto.createHash("sha256").update(buffer).digest("hex").slice(0,8);
    const ins = await client.query(
      `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
       VALUES ($1,$2,$3,$4,now())
       RETURNING photo_id`,
      [temp, originalname, mimetype, buffer]
    );
    const photoId = ins.rows[0].photo_id;
    await client.query("COMMIT");   // ✅ 여기서 커밋해야 /api/images 가 바로 읽힘

    /* 2) 서명 URL 생성 후, 가시성 짧게 확인 */
    const token = jwt.sign({ id:String(photoId) }, process.env.IMG_TOKEN_SECRET, { expiresIn: IMG_TOKEN_TTL });
    imageUrl = `${apiBase(req)}/images/${photoId}?token=${token}`;

    await waitImageVisible(imageUrl); // 짧은 리트라이(선택적, 안정성 ↑)

    /* 3) AI 호출 */
    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id:String(photoId), user_id:String(userId) },
      { timeout: AI_TIMEOUT }
    );

    /* 4) 분석 값 파싱 + mood 매핑 저장 (별도 트랜잭션) */
    const time = ai.time_label || ai.time || null;
    const back = ai.background || ai.scene || ai.category || null;
    const emo  = ai.emotion    || ai.final_emotion || ai.rule_emotion || null;

    await client.query("BEGIN");
    const { main_mood, sub_mood } = await resolveMood(
      client, time, back, emo,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [photoId, time, back, emo, main_mood, sub_mood]
    );

    const items = await fetchRecs(client, main_mood, sub_mood);
    await client.query("COMMIT");

    return res.json({
      photoId,
      analysis: { time_label: time, background: back, emotion: emo, main_mood, sub_mood },
      recommendations: items,
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    const raw = (err && err.response && err.response.data) || err?.message || err?.toString() || "unknown error";
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    console.error("[analyze FAILED]", { detail, ai_url: `${process.env.AI_BASE_URL}/predict`, imageUrl });
    return res.status(500).json({ error:"analyze failed", detail, from:"routes/photos.js#analyze", imageUrl });
  } finally {
    client.release();
  }
});

/* 기존 사진 id 재분석 (이 경로도 커밋 후 호출 패턴 유지) */
router.post("/:photoId/analyze", async (req,res)=>{
  let imageUrl;
  const client = await pool.connect();
  try {
    const { photoId } = req.params;
    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";

    const ex = await client.query(`SELECT 1 FROM photos WHERE photo_id=$1 OR id=$1`, [photoId]);
    if (!ex.rows.length) return res.status(404).json({ error:"photo not found" });

    const token = jwt.sign({ id:String(photoId) }, process.env.IMG_TOKEN_SECRET, { expiresIn: IMG_TOKEN_TTL });
    imageUrl = `${apiBase(req)}/images/${photoId}?token=${token}`;
    await waitImageVisible(imageUrl);

    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id:String(photoId), user_id:String(userId) },
      { timeout: AI_TIMEOUT }
    );

    const time = ai.time_label || ai.time || null;
    const back = ai.background || ai.scene || ai.category || null;
    const emo  = ai.emotion    || ai.final_emotion || ai.rule_emotion || null;

    await client.query("BEGIN");
    const { main_mood, sub_mood } = await resolveMood(
      client, time, back, emo,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [photoId, time, back, emo, main_mood, sub_mood]
    );
    await client.query("COMMIT");

    return res.json({
      ok:true,
      photo_id:Number(photoId),
      analysis:{ time_label:time, background:back, emotion:emo, main_mood, sub_mood }
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    const raw = (err && err.response && err.response.data) || err?.message || err?.toString() || "unknown error";
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    console.error("[analyze by id FAILED]", { detail, ai_url:`${process.env.AI_BASE_URL}/predict`, imageUrl });
    return res.status(500).json({ error:"analyze by id failed", detail, from:"routes/photos.js#byId", imageUrl });
  } finally {
    client.release();
  }
});

module.exports = router;
