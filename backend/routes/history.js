// routes/history.js
const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * POST /api/history
 * body: { user_id, photo_id, music_id, selected_from?('main'|'sub') }
 * 동작: music 메타 조회 → history 스냅샷 저장 (중복이면 업데이트 타임스탬프 갱신)
 */
router.post('/', async (req, res) => {
  const { user_id, photo_id, music_id, selected_from } = req.body || {};
  if (!user_id || !photo_id || !music_id) {
    return res.status(400).json({ error: 'user_id, photo_id, music_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) music 메타 조회
    const { rows: mRows, rowCount } = await client.query(
      'SELECT title, artist, genre, label FROM music WHERE music_id = $1',
      [music_id]
    );
    if (rowCount === 0) throw new Error('Music not found');

    const { title, artist, genre, label } = mRows[0];

    // 2) history 업서트
    const upsertSql = `
      INSERT INTO history
        (user_id, photo_id, music_id,
         title_snapshot, artist_snapshot, genre_snapshot, label_snapshot,
         selected_from)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (user_id, photo_id, music_id)
      DO UPDATE SET
        title_snapshot  = EXCLUDED.title_snapshot,
        artist_snapshot = EXCLUDED.artist_snapshot,
        genre_snapshot  = EXCLUDED.genre_snapshot,
        label_snapshot  = EXCLUDED.label_snapshot,
        selected_from   = COALESCE(EXCLUDED.selected_from, history.selected_from),
        created_at      = NOW()
      RETURNING history_id, user_id, photo_id, music_id,
                title_snapshot AS title, artist_snapshot AS artist,
                genre_snapshot AS genre, label_snapshot AS label,
                selected_from, created_at
    `;

    const { rows: saved } = await client.query(upsertSql, [
      user_id,
      photo_id,
      music_id,
      title,
      artist,
      genre || null,
      label || null,
      selected_from || null
    ]);

    await client.query('COMMIT');
    return res.status(201).json(saved[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[history][create]', err);
    return res.status(500).json({ error: 'Failed to save history' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/history?user_id=123
 * 유저의 저장 이력 조회
 */
router.get('/', async (req, res) => {
  const userId = Number(req.query.user_id);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT h.history_id, h.user_id, h.photo_id, h.music_id,
              h.title_snapshot AS title, h.artist_snapshot AS artist,
              h.genre_snapshot AS genre, h.label_snapshot AS label,
              h.selected_from, h.created_at
         FROM history h
        WHERE h.user_id = $1
        ORDER BY h.created_at DESC, h.history_id DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[history][list]', err);
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// 0924 편집본 저장
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** 편집본 바이너리: GET /api/history/:id/edited-image/binary */
router.get("/:id/edited-image/binary", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });

    const { rows } = await pool.query(
      "SELECT edited_mime_type, edited_image FROM history WHERE history_id=$1",
      [id]
    );
    if (!rows[0] || !rows[0].edited_image) return res.status(404).send("Not found");

    res.set("Content-Type", rows[0].edited_mime_type || "application/octet-stream");
    return res.send(rows[0].edited_image);
  } catch (e) {
    console.error("[history/edited/binary]", e);
    return res.status(500).json({ error: "binary failed" });
  }
});

/** 편집본 업로드: POST /api/history/:id/edited-image (form-data: file)
 * - 새 테이블 없이 history 테이블에 바로 저장
 */
router.post("/:id/edited-image", upload.single("file"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });
    if (!req.file) return res.status(400).json({ error: "no file" });

    const { buffer, mimetype } = req.file;
    if (!/^image\/(png|webp|jpeg)$/.test(mimetype)) {
      return res.status(400).json({ error: "image/png, image/webp, image/jpeg only" });
    }

    await pool.query(
      `UPDATE history
         SET edited_image=$1,
             edited_mime_type=$2,
             edited_at=now()
       WHERE history_id=$3`,
      [buffer, mimetype, id]
    );

    // 프론트에서 <img src>로 바로 쓰게 /binary URL 반환
    const base = `${req.protocol}://${req.get("host")}`;
    const editedUrl = `${base}/api/history/${id}/edited-image/binary`;
    // URL 컬럼을 추가해 쓰고 싶다면 아래 한 줄도 가능(선택)
    // await pool.query(`UPDATE history SET edited_image_url=$1 WHERE history_id=$2`, [editedUrl, id]);

    return res.json({ edited_image_url: editedUrl });
  } catch (e) {
    console.error("[history/edited/upload]", e);
    return res.status(500).json({ error: "upload failed" });
  }
});

module.exports = router;
