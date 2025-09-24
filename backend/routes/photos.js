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

/* ── 공통 CORS 헬퍼 ─────────────────────────────────────────────── */
function allowCORS(req, res) {
  const origin = req.headers.origin || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
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

/* 디버그 */
router.get("/_who", (_req,res) =>
  res.json({ from:"routes/photos.js", analyzePath:"/api/photos/analyze" })
);

/* 바이너리 내려주기 (CORS 포함) */
/* 바이너리 내려주기 (CORS 포함) — bytea(hex) → Buffer 변환 */
router.get("/:photoId/binary", async (req, res) => {
  try {
    const { photoId } = req.params;
    const r = await pool.query(
      "SELECT mime_type, content FROM photos WHERE photo_id=$1 LIMIT 1",
      [photoId]
    );
    if (!r.rows.length) return res.status(404).send("Not found");

    let { mime_type, content } = r.rows[0];
    let buf;

    if (Buffer.isBuffer(content)) {
      buf = content; // 이미 Buffer
    } else if (typeof content === "string") {
      if (content.startsWith("\\x")) {
        // Postgres bytea hex 문자열
        buf = Buffer.from(content.slice(2), "hex");
      } else if (content.startsWith("data:")) {
        // data URL 형태로 저장된 경우
        buf = Buffer.from(content.split(",")[1] || "", "base64");
      } else {
        // 혹시 모를 base64/일반 문자열 대비
        try { buf = Buffer.from(content, "base64"); }
        catch { buf = Buffer.from(content); }
      }
    } else {
      return res.status(500).send("invalid content");
    }

    allowCORS(req, res);
    res.set("Cache-Control", "no-store");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Content-Type", mime_type || "application/octet-stream");
    res.set("Content-Length", String(buf.length));
    res.end(buf); // ✅ 진짜 바이너리로 응답
  } catch (e) {
    console.error("[photos/binary] error:", e);
    res.status(500).send("Error");
  }
});

/* 업로더(업서트) – 편집본 저장: multipart/form-data 의 file 필드 사용 */
async function upsertBinary(req, res) {
  const photoId = Number(req.params.photoId);
  if (!Number.isFinite(photoId)) {
    return res.status(400).json({ error: "bad photoId" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "file field is required" });
  }

  const { buffer, mimetype, originalname } = req.file;

  try {
    const sql = `
      INSERT INTO photos (photo_id, temp_name, original_name, mime_type, content, created_at)
      VALUES ($1, NULL, $2, $3, $4, NOW())
      ON CONFLICT (photo_id) DO UPDATE SET
        original_name = EXCLUDED.original_name,
        mime_type     = EXCLUDED.mime_type,
        content       = EXCLUDED.content
      RETURNING photo_id
    `;
    const { rows } = await pool.query(sql, [
      photoId,
      originalname || null,
      mimetype || "image/png",
      buffer,
    ]);

    allowCORS(req, res);
    res.json({ ok: true, photo_id: rows[0].photo_id });
  } catch (e) {
    console.error("[photos][binary upsert] failed:", e);
    res.status(500).json({ error: "binary upsert failed" });
  }
}
router.options("/:photoId/binary", (req,res) => { allowCORS(req,res); res.sendStatus(200); });
router.post("/:photoId/binary", upload.single("file"), upsertBinary);
router.put("/:photoId/binary",  upload.single("file"), upsertBinary);

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
        validateStatus: () => true,
      });
      if (r.status === 200) {
        if (r.data && typeof r.data.destroy === "function") r.data.destroy();
        return true;
      }
      if (r.data && typeof r.data.destroy === "function") r.data.destroy();
    } catch (_) {}
    await new Promise(res => setTimeout(res, 80));
  }
  return false;
}

// GET /api/photo-analysis/:photoId (프론트 디버깅용)
router.get("/photo-analysis/:photoId", async (req, res) => {
  const photoId = Number(req.params.photoId);
  if (!Number.isFinite(photoId)) return res.status(400).json({ error: "bad id" });
  const { rows } = await pool.query(
    `SELECT time_label, background, emotion, main_mood, sub_mood
       FROM photo_analysis
      WHERE photo_id = $1
   ORDER BY analyzed_at DESC
      LIMIT 1`,
    [photoId]
  );
  if (!rows.length) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

/* 업로드 + 즉시 분석 (추천은 recommendations 라우터에서 별도로 조회) */
router.post("/analyze", upload.single("file"), async (req,res)=>{
  let imageUrl;
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error:"no file" });
    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";
    const { buffer, originalname, mimetype } = req.file;

    await client.query("BEGIN");
    const temp = crypto.createHash("sha256").update(buffer).digest("hex").slice(0,8);
    const ins = await client.query(
      `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
       VALUES ($1,$2,$3,$4,now())
       RETURNING photo_id`,
      [temp, originalname, mimetype, buffer]
    );
    const photoId = ins.rows[0].photo_id;
    await client.query("COMMIT");

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
      photoId,
      analysis: { time_label: time, background: back, emotion: emo, main_mood, sub_mood },
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

/* 기존 사진 id 재분석 */
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
