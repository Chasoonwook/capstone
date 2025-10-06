// routes/diaries.js
const express = require("express");
const pool = require("../db");
const router = express.Router();

const nn = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const toNumOrNull = (v) =>
  v === undefined || v === null || v === "" ? null : (Number(v) || null);

// 공통 SELECT: 프론트에서 바로 쓰기 좋게 별칭
const SELECT_ALIAS = `
  id,
  user_id,
  photo_id,
  music_id,
  music_title_snapshot  AS music_title,
  music_artist_snapshot AS music_artist,
  subject,
  content,
  diary_at,
  created_at,
  updated_at
`;

// ------------------------------------------------------------------
// 생성(업서트: user_id+photo_id 존재시 업데이트)
// POST /api/diaries
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

    user_id = toNumOrNull(user_id);
    if (user_id == null) return res.status(400).json({ error: "user_id must be integer" });

    photo_id = toNumOrNull(photo_id);
    music_id = toNumOrNull(music_id);
    const music_title_snapshot = nn(music_title);
    const music_artist_snapshot = nn(music_artist);
    subject = subject ?? "";
    content = content ?? "";

    const diary_at_iso = (() => {
      const raw = nn(diary_at);
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d.toISOString();
    })();

    await client.query("BEGIN");

    // 업서트 기준 찾기
    let existing = null;
    if (photo_id != null) {
      const { rows } = await client.query(
        `SELECT id FROM diaries WHERE user_id=$1 AND photo_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [user_id, photo_id]
      );
      existing = rows[0] || null;
    }

    let row;
    if (existing) {
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
        RETURNING ${SELECT_ALIAS};
        `,
        [music_id, music_title_snapshot, music_artist_snapshot, subject, content, diary_at_iso, existing.id]
      );
      row = rows[0];
    } else {
      const { rows } = await client.query(
        `
        INSERT INTO diaries
          (user_id, photo_id, music_id, music_title_snapshot, music_artist_snapshot, subject, content, diary_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING ${SELECT_ALIAS};
        `,
        [user_id, photo_id, music_id, music_title_snapshot, music_artist_snapshot, subject, content, diary_at_iso]
      );
      row = rows[0];
    }

    await client.query("COMMIT");
    return res.status(existing ? 200 : 201).json(row);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[POST /api/diaries] BODY=", req.body);
    console.error("[POST /api/diaries] ERROR=", e);
    const msg = e?.detail || e?.message || "failed to create or update diary";
    const code = (e?.code === "23505" || e?.code === "23503") ? 400 : 500;
    res.status(code).json({ error: msg, code: e?.code ?? null });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------
// 목록
// GET /api/diaries?user_id=...&photo_id?=...&limit?=200
router.get("/", async (req, res) => {
  try {
    const user_id = toNumOrNull(req.query.user_id);
    if (user_id == null) return res.status(400).json({ error: "user_id must be integer" });

    const photo_id = toNumOrNull(req.query.photo_id);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "200", 10) || 200, 1), 500);

    let q = `
      SELECT ${SELECT_ALIAS}
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
// 포토 기준 단건 조회
// GET /api/diaries/by-photo?user_id=...&photo_id=...
router.get("/by-photo", async (req, res) => {
  try {
    const user_id = toNumOrNull(req.query.user_id);
    const photo_id = toNumOrNull(req.query.photo_id);

    if (user_id == null) return res.status(400).json({ error: "user_id must be integer" });
    if (photo_id == null) return res.status(400).json({ error: "photo_id must be integer" });

    const { rows } = await pool.query(
      `
      SELECT ${SELECT_ALIAS}
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
    const id = toNumOrNull(req.params.id);
    if (id == null) return res.status(400).json({ error: "invalid id" });
    const { rows } = await pool.query(`SELECT ${SELECT_ALIAS} FROM diaries WHERE id=$1`, [id]);
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
    const id = toNumOrNull(req.params.id);
    if (id == null) return res.status(400).json({ error: "invalid id" });
    const { subject, content, music_id, music_title, music_artist, diary_at } = req.body || {};

    const diary_at_iso = (() => {
      const raw = nn(diary_at);
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d.toISOString();
    })();

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
      RETURNING ${SELECT_ALIAS};
      `,
      [
        subject ?? null,
        content ?? null,
        toNumOrNull(music_id),
        nn(music_title),
        nn(music_artist),
        diary_at_iso,
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
    const id = toNumOrNull(req.params.id);
    if (id == null) return res.status(400).json({ error: "invalid id" });
    const { rowCount } = await pool.query("DELETE FROM diaries WHERE id=$1", [id]);
    if (!rowCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/diaries/:id]", e);
    res.status(500).json({ error: "failed to delete diary" });
  }
});

module.exports = router;
