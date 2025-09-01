// routes/photos.js
const express = require("express");
const pool = require("../db");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const router = express.Router();

// === ENV ===
const USE_ASYNC = process.env.ASYNC_MODE === "1";                   // 업로드/대기목록 라우트 토글
const AI_TIMEOUT = Number(process.env.AI_FETCH_TIMEOUT || 60000);   // AI 호출 타임아웃(ms)
const IMG_TOKEN_TTL = String(process.env.IMG_TOKEN_TTL || "180s");  // 이미지 토큰 TTL

// 업로드(메모리) — 20MB 제한
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// 부트 시 photo_temp_name_seq 없으면 생성
async function ensurePhotoTempNameSeq() {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'S' AND c.relname = 'photo_temp_name_seq'
        ) THEN
          CREATE SEQUENCE photo_temp_name_seq START 1;
        END IF;
      END$$;
    `);
  } catch (e) {
    console.warn("[photos] ensurePhotoTempNameSeq skipped:", e.message);
  }
}
ensurePhotoTempNameSeq();

/* ────────────────────────────────────────────────────────────────
 * A) (옵션) 비동기 업로드/대기목록 — ASYNC_MODE=1 일 때만 활성화
 * ──────────────────────────────────────────────────────────────── */
if (USE_ASYNC) {
  // POST /api/photos/upload : 사진만 저장
  router.post("/upload", upload.single("photo"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const { rows: seqRows } = await client.query(
          "SELECT nextval('photo_temp_name_seq') AS n"
        );
        const tempName = seqRows[0].n;

        const insertSql = `
          INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
          VALUES ($1, $2, $3, $4, now())
          RETURNING photo_id, temp_name, original_name, mime_type, created_at
        `;
        const vals = [
          tempName,
          req.file.originalname,
          req.file.mimetype,
          req.file.buffer,
        ];
        const { rows } = await client.query(insertSql, vals);

        await client.query("COMMIT");
        return res.json(rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("Upload error:", e);
        return res.status(500).json({ error: "Upload failed" });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Upload outer error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // GET /api/photos/pending : 아직 분석 안 된 목록
  router.get("/pending", async (_req, res) => {
    try {
      const sql = `
        SELECT p.photo_id, p.temp_name, p.original_name, p.mime_type, p.created_at
        FROM photos p
        LEFT JOIN photo_analysis a ON a.photo_id = p.photo_id
        WHERE a.photo_id IS NULL
        ORDER BY p.created_at ASC
        LIMIT 50
      `;
    const { rows } = await pool.query(sql);
      res.json(rows);
    } catch (err) {
      console.error("Pending error:", err);
      res.status(500).json({ error: "Error fetching pending photos" });
    }
  });
}

/* ────────────────────────────────────────────────────────────────
 * B) 바이너리 제공 (동기/비동기 공용)
 * ──────────────────────────────────────────────────────────────── */
router.get("/:photoId/binary", async (req, res) => {
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
    console.error("Binary error:", err);
    res.status(500).send("Error");
  }
});

/* ────────────────────────────────────────────────────────────────
 * C) photo_history CRUD
 * ──────────────────────────────────────────────────────────────── */
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM photo_history ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get("/user/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM photo_history WHERE user_id = $1",
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post("/", async (req, res) => {
  const { user_id, file_path, file_name, labels, parameters, feedback } =
    req.body;
  try {
    const result = await pool.query(
      "INSERT INTO photo_history (user_id, file_path, file_name, labels, parameters, feedback) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [user_id, file_path, file_name, labels, parameters, feedback]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM photo_history WHERE photo_id = $1", [id]);
    res.send("Photo deleted");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ────────────────────────────────────────────────────────────────
 * D) mood 매핑/추천 유틸 + 업로드 동기 분석 (기존 구현)
 * ──────────────────────────────────────────────────────────────── */
async function resolveMood(client, timeLabel, background, emotion, provided) {
  if (provided?.main_mood) {
    return {
      main_mood: provided.main_mood,
      sub_mood: provided.sub_mood || provided.mood_sub || null,
    };
  }
  const { rows } = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      WHERE time_label = $1 AND background = $2 AND emotion = $3
      LIMIT 1`,
    [timeLabel, background, emotion]
  );
  if (rows[0]) return rows[0];

  const alt = await client.query(
    `SELECT main_mood, sub_mood
       FROM mood_mapping
      WHERE time_label = $1
      LIMIT 1`,
    [timeLabel]
  );
  return alt.rows[0] || { main_mood: null, sub_mood: null };
}

async function getRecommendations(client, mainMood, subMood) {
  const { rows: mainRows } = await client.query(
    `SELECT music_id, title, artist, label, genre
       FROM music
      WHERE label = $1
      ORDER BY created_at DESC
      LIMIT 7`,
    [mainMood]
  );
  const { rows: subRows } = await client.query(
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
  return [...mainRows, ...subRows];
}

/** 업로드 → AI → 저장 → 추천 (기존) */
router.post("/analyze", upload.single("file"), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });

    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";
    const { buffer, originalname, mimetype } = req.file;

    await client.query("BEGIN");

    // 1) photos 저장
    const tempName = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 8);
    const { rows: ins } = await client.query(
      `INSERT INTO photos (temp_name, original_name, mime_type, content, created_at)
       VALUES ($1,$2,$3,$4, now())
       RETURNING photo_id`,
      [tempName, originalname, mimetype, buffer]
    );
    const photoId = ins[0].photo_id;

    // (옵션) history 기록
    await client.query(
      `INSERT INTO photo_history (photo_id, user_id, file_name, labels, parameters, feedback, created_at)
       VALUES ($1,$2,$3,NULL,NULL,NULL, now())`,
      [photoId, userId, originalname]
    );

    // 2) 서명 URL
    const token = jwt.sign({ id: String(photoId) }, process.env.IMG_TOKEN_SECRET, {
      expiresIn: IMG_TOKEN_TTL,
    });
    const publicApiBase =
      process.env.PUBLIC_API_BASE ||
      `${req.protocol}://${req.get("host")}/api`;
    const imageUrl = `${publicApiBase}/images/${photoId}?token=${token}`;

    // 3) AI 호출
    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id: photoId, user_id: userId },
      { timeout: AI_TIMEOUT }
    );

    const timeLabel = ai.time_label || ai.time || null;
    const background = ai.background || ai.scene || null;
    const emotion = ai.emotion || ai.face_emotion || null;

    const { main_mood, sub_mood } = await resolveMood(
      client,
      timeLabel,
      background,
      emotion,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    // 4) 분석 저장(멱등)
    await client.query("DELETE FROM photo_analysis WHERE photo_id = $1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())`,
      [photoId, timeLabel, background, emotion, main_mood, sub_mood]
    );

    // 5) 추천 7 + 3
    const recs = await getRecommendations(client, main_mood, sub_mood);

    // (옵션) 추천 로그
    await client.query(
      `INSERT INTO recommendations (photo_id, user_id, result, created_at)
       VALUES ($1,$2,$3, now())`,
      [photoId, userId, JSON.stringify(recs)]
    );

    await client.query("COMMIT");

    console.log("[AI]", { photoId, timeLabel, background, emotion, main_mood, sub_mood });
    return res.json({
      photoId,
      analysis: { time_label: timeLabel, background, emotion, main_mood, sub_mood },
      recommendations: recs,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[analyze]", err?.response?.data || err.message);
    res.status(500).json({ error: "analyze failed" });
  } finally {
    client.release();
  }
});

/* ────────────────────────────────────────────────────────────────
 * E) ✅ 추가: DB에 이미 있는 사진을 by-id로 분석
 *    POST /api/photos/:photoId/analyze
 * ──────────────────────────────────────────────────────────────── */
router.post("/:photoId/analyze", async (req, res) => {
  const client = await pool.connect();
  try {
    const { photoId } = req.params;
    const userId = req.body.userId || "00000000-0000-0000-0000-000000000000";

    // 사진 존재 확인
    const { rows: pRows } = await client.query(
      "SELECT 1 FROM photos WHERE photo_id = $1",
      [photoId]
    );
    if (!pRows.length) return res.status(404).json({ error: "photo not found" });

    await client.query("BEGIN");

    // 1) 서명 URL
    const token = jwt.sign({ id: String(photoId) }, process.env.IMG_TOKEN_SECRET, {
      expiresIn: IMG_TOKEN_TTL,
    });
    const publicApiBase =
      process.env.PUBLIC_API_BASE ||
      `${req.protocol}://${req.get("host")}/api`;
    const imageUrl = `${publicApiBase}/images/${photoId}?token=${token}`;

    // 2) AI 호출
    const { data: ai } = await axios.post(
      `${process.env.AI_BASE_URL}/predict`,
      { image_url: imageUrl, photo_id: Number(photoId), user_id: userId },
      { timeout: AI_TIMEOUT }
    );

    const timeLabel = ai.time_label || ai.time || null;
    const background = ai.background || ai.scene || null;
    const emotion = ai.emotion || ai.face_emotion || null;

    // 3) mood 매핑
    const { main_mood, sub_mood } = await resolveMood(
      client,
      timeLabel,
      background,
      emotion,
      { main_mood: ai.mood || ai.mood_main, sub_mood: ai.mood_sub }
    );

    // 4) 분석 저장(멱등)
    await client.query("DELETE FROM photo_analysis WHERE photo_id = $1", [photoId]);
    await client.query(
      `INSERT INTO photo_analysis
         (photo_id, time_label, background, emotion, main_mood, sub_mood, created_at)
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
    console.error("[analyze by id]", err?.response?.data || err.message);
    res.status(500).json({ error: "analyze by id failed" });
  } finally {
    client.release();
  }
});

module.exports = router;
