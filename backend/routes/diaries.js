// routes/diaries.js
const express = require("express");
const pool = require("../db"); // 기존 PG Pool
const router = express.Router();

const nn = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const toNumOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v) || null);

// ------------------------------------------------------------------
// 생성 (또는 업서트: user_id + photo_id 가 있으면 수정, 없으면 생성)
// POST /api/diaries
// body: { user_id, photo_id?, music_id?, music_title?, music_artist?, subject, content, diary_at? }
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    let {
      user_id,
      photo_id,
      music_id,
      music_title,
      music_artist,
      subject,
      content,
      diary_at,
    } = req.body || {};

    user_id = nn(user_id);
    if (!user_id) return res.status(400).json({ error: "user_id is required" });

    photo_id = toNumOrNull(photo_id);
    music_id = toNumOrNull(music_id);
    const music_title_snapshot = nn(music_title);
    const music_artist_snapshot = nn(music_artist);
    subject = subject ?? "";
    content = content ?? "";
    diary_at = nn(diary_at);

    await client.query("BEGIN");

    // photo_id가 있을 때만 업서트 기준을 적용
    let existing = null;
    if (photo_id != null) {
      const { rows } = await client.query(
        `SELECT * FROM diaries WHERE user_id=$1 AND photo_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [user_id, photo_id]
      );
      existing = rows[0] || null;
    }

    let row;
    if (existing) {
      // 업데이트
      const { rows } = await client.query(
        `
        UPDATE diaries SET
          music_id = COALESCE($1, music_id),
          music_title_snapshot = COALESCE($2, music_title_snapshot),
          music_artist_snapshot = COALESCE($3, music_artist_snapshot),
          subject = $4,
          content = $5,
          diary_at = COALESCE($6, diary_at),
          updated_at = NOW()
        WHERE id = $7
        RETURNING *;
        `,
        [
          music_id,
          music_title_snapshot,
          music_artist_snapshot,
          subject,
          content,
          diary_at,
          existing.id,
        ]
      );
      row = rows[0];
    } else {
      // 새로 생성
      const { rows } = await client.query(
        `
        INSERT INTO diaries
          (user_id, photo_id, music_id, music_title_snapshot, music_artist_snapshot, subject, content, diary_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
        `,
        [
          user_id,
          photo_id,
          music_id,
          music_title_snapshot,
          music_artist_snapshot,
          subject,
          content,
          diary_at,
        ]
      );
      row = rows[0];
    }

    await client.query("COMMIT");
    return res.status(existing ? 200 : 201).json(row);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[POST /api/diaries]", e);
    res.status(500).json({ error: "failed to create or update diary" });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------
// 목록
// GET /api/diaries?user_id=...&photo_id?=...&limit?=200
router.get("/", async (req, res) => {
  try {
    const user_id = nn(req.query.user_id);
    if (!user_id) return res.status(400).json({ error: "user_id is required" });

    const photo_id = toNumOrNull(req.query.photo_id);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "200", 10) || 200, 1), 500);

    let q = `
      SELECT *
      FROM diaries
      WHERE user_id = $1
    `;
    const params = [user_id];

    if (photo_id != null) {
      q += ` AND photo_id = $2`;
      params.push(photo_id);
    }

    q += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) {
    console.error("[GET /api/diaries]", e);
    res.status(500).json({ error: "failed to list diaries" });
  }
});

// ------------------------------------------------------------------
// 포토 기준 단건 조회 (포토ID별 1개 정책 지원)
// GET /api/diaries/by-photo?user_id=...&photo_id=...
router.get("/by-photo", async (req, res) => {
  try {
    const user_id = nn(req.query.user_id);
    const photo_id = toNumOrNull(req.query.photo_id);

    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    if (photo_id == null) return res.status(400).json({ error: "photo_id is required" });

    const { rows } = await pool.query(
      `
      SELECT *
      FROM diaries
      WHERE user_id = $1 AND photo_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user_id, photo_id]
    );

    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("[GET /api/diaries/by-photo]", e);
    res.status(500).json({ error: "failed to get diary by photo" });
  }
});

// ------------------------------------------------------------------
// 단건 조회
// GET /api/diaries/:id
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });
    const { rows } = await pool.query("SELECT * FROM diaries WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("[GET /api/diaries/:id]", e);
    res.status(500).json({ error: "failed to get diary" });
  }
});

// ------------------------------------------------------------------
// 수정
// PUT /api/diaries/:id
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });
    const { subject, content, music_id, music_title, music_artist, diary_at } = req.body || {};

    const { rows } = await pool.query(
      `
      UPDATE diaries SET
        subject = COALESCE($1, subject),
        content = COALESCE($2, content),
        music_id = COALESCE($3, music_id),
        music_title_snapshot = COALESCE($4, music_title_snapshot),
        music_artist_snapshot = COALESCE($5, music_artist_snapshot),
        diary_at = COALESCE($6, diary_at),
        updated_at = NOW()
      WHERE id = $7
      RETURNING *;
      `,
      [
        subject ?? null,
        content ?? null,
        toNumOrNull(music_id),
        nn(music_title),
        nn(music_artist),
        nn(diary_at),
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("[PUT /api/diaries/:id]", e);
    res.status(500).json({ error: "failed to update diary" });
  }
});

// ------------------------------------------------------------------
// 삭제
// DELETE /api/diaries/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });
    const { rowCount } = await pool.query("DELETE FROM diaries WHERE id=$1", [id]);
    if (!rowCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/diaries/:id]", e);
    res.status(500).json({ error: "failed to delete diary" });
  }
});

module.exports = router;
