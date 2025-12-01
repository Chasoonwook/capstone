// routes/photos.js
const express = require("express");
const pool = require("../db");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const FormData = require("form-data");

const router = express.Router();

const AI_TIMEOUT    = Number(process.env.AI_FETCH_TIMEOUT || 60000);
const IMG_TOKEN_TTL = String(process.env.IMG_TOKEN_TTL || "600s");

const IMAGE_MIME_WHITELIST = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function apiBase(req) {
  const envBase = process.env.PUBLIC_API_BASE;
  if (envBase) return envBase.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}/api`;
}

// CORS 허용 설정
function allowCORS(req, res) {
  const origin = req.headers.origin || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
}

// mood 매핑 함수를 AI 서버의 응답 형식에 맞게 단순화
async function resolveMood(client, timeLabel, background, emotion) {
  const t = (timeLabel || "").trim().toLowerCase();
  const b = (background || "").trim().toLowerCase();
  const e = (emotion || "").trim().toLowerCase();

  let q = await client.query(`SELECT main_mood, sub_mood FROM mood_mapping WHERE LOWER(TRIM(time)) = $1 AND LOWER(TRIM(background)) = $2 AND LOWER(TRIM(emotion)) = $3 LIMIT 1`, [t, b, e]);
  if (q.rows[0]) return q.rows[0];

  q = await client.query(`SELECT main_mood, sub_mood FROM mood_mapping WHERE LOWER(TRIM(time)) = $1 AND LOWER(TRIM(background)) = $2 ORDER BY mapping_id LIMIT 1`, [t, b]);
  if (q.rows[0]) return q.rows[0];

  q = await client.query(`SELECT main_mood, sub_mood FROM mood_mapping WHERE LOWER(TRIM(time)) = $1 ORDER BY mapping_id LIMIT 1`, [t]);
  if (q.rows[0]) return q.rows[0];

  q = await client.query(`SELECT main_mood, sub_mood FROM mood_mapping ORDER BY mapping_id LIMIT 1`);
  return q.rows[0] || { main_mood: null, sub_mood: null };
}

// 헬스체크
router.get("/_who", (_req,res) =>
  res.json({ from:"routes/photos.js", analyzePath:"/api/photos/analyze" })
);

// 바이너리 사진 조회
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
      buf = content; 
    } else if (typeof content === "string") {
      if (content.startsWith("\\x")) {
        // PostgreSQL의 bytea 형식으로 저장된 경우
        buf = Buffer.from(content.slice(2), "hex");
      } else if (content.startsWith("data:")) {
        // data URI 형식으로 저장된 경우
        buf = Buffer.from(content.split(",")[1] || "", "base64");
      } else {
        // 기타 base64 인코딩된 문자열로 저장된 경우
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
    res.end(buf); 
  } catch (e) {
    console.error("[photos/binary] error:", e);
    res.status(500).send("Error");
  }
});

// POST / PUT /api/photos/:photoId/binary
// 사진 바이너리 업서트
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

// GET /api/photos/:photoId/signed-url
// 사진에 접근할 수 있는 서명된 URL 생성
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

// 이미지가 접근 가능해질 때까지 대기 (최대 5회)
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

// GET /api/photo-analysis/:photoId
// 사진 분석 결과 조회
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

// POST /api/photos/analyze
// 사진 업로드 및 분석
router.post("/analyze", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "no file" });
  }

  const client = await pool.connect();
  try {
    const { buffer, originalname, mimetype } = req.file;

    // AI 서버 호출
    const form = new FormData();
    form.append('file', buffer, { filename: originalname, contentType: mimetype });

    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/analyze/`,
      form,
      { headers: form.getHeaders(), timeout: AI_TIMEOUT }
    );

    // 새로운 AI 서버 응답 파싱
    const time = (ai.detail_tags?.rule || [])[0] || null;
    const back = ai.background || null;
    const emo = ai.emotion || null;

    await client.query("BEGIN");

    // 원본 사진 DB에 저장
    const ins = await client.query(
      `INSERT INTO photos (original_name, mime_type, content, created_at) VALUES ($1, $2, $3, now()) RETURNING photo_id`,
      [originalname, mimetype, buffer]
    );
    const photoId = ins.rows[0].photo_id;

    // 분석 결과를 바탕으로 mood 결정
    const { main_mood, sub_mood } = await resolveMood(client, time, back, emo);

    // 최종 분석 결과를 photo_analysis DB에 저장
    await client.query(
      `INSERT INTO photo_analysis (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at) VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [photoId, time, back, emo, main_mood, sub_mood]
    );

    await client.query("COMMIT");

    return res.json({
      photoId,
      analysis: { time_label: time, background: back, emotion: emo, main_mood, sub_mood },
    });

  } catch (err) {
    await client.query("ROLLBACK");
    const detail = err.response?.data?.detail || err.message || "unknown error";
    console.error("[analyze FAILED]", { detail });
    return res.status(500).json({ error: "analyze failed", detail });
  } finally {
    client.release();
  }
});

// POST /api/photos/:photoId/analyze
// 기존 사진에 대해 분석 수행
router.post("/:photoId/analyze", async (req, res) => {
  const client = await pool.connect();
  try {
    const { photoId } = req.params;

    // DB에서 이미지 데이터 가져오기
    const photoRes = await client.query(`SELECT content, original_name, mime_type FROM photos WHERE photo_id=$1`, [photoId]);
    if (!photoRes.rows.length) {
      return res.status(404).json({ error: "photo not found" });
    }
    const { content: buffer, original_name: originalname, mime_type: mimetype } = photoRes.rows[0];

    // AI 서버 호출
    const form = new FormData();
    form.append('file', buffer, { filename: originalname || 'image.jpg', contentType: mimetype });

    const { data: ai } = await axios.post(
        `${process.env.AI_BASE_URL}/analyze/`,
        form,
        { headers: form.getHeaders(), timeout: AI_TIMEOUT }
    );

    // 새로운 AI 서버 응답 파싱
    const time = (ai.detail_tags?.rule || [])[0] || null;
    const back = ai.background || null;
    const emo = ai.emotion || null;

    await client.query("BEGIN");
    
    // 분석 결과를 바탕으로 mood 결정
    const { main_mood, sub_mood } = await resolveMood(client, time, back, emo);
    
    // 이전 분석 결과 삭제 후 새로 저장
    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis (photo_id, time_label, background, emotion, main_mood, sub_mood, analyzed_at) VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [photoId, time, back, emo, main_mood, sub_mood]
    );
    
    await client.query("COMMIT");

    return res.json({
      ok: true,
      photo_id: Number(photoId),
      analysis: { time_label: time, background: back, emotion: emo, main_mood, sub_mood }
    });

  } catch (err) {
    await client.query("ROLLBACK");
    const detail = err.response?.data?.detail || err.message || "unknown error";
    console.error("[analyze by id FAILED]", { detail });
    return res.status(500).json({ error: "analyze by id failed", detail });
  } finally {
    client.release();
  }
});


module.exports = router;
