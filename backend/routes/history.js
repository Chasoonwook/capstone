// routes/history.js
const express = require('express');
const pool = require('../db');
const multer = require('multer');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// 허용 값만 통과, 나머지는 null 처리
function normalizeSelectedFrom(v) {
  return v === 'main' || v === 'sub' ? v : null;
}

/** 트랜잭션 밖에서 안전하게 music 메타를 찾아오는 헬퍼 (없으면 null) */
async function fetchMusicMetaSafe(musicId) {
  const candidates = [
    'SELECT title, artist, genre, label FROM musics WHERE id = $1',
    'SELECT title, artist, genre, label FROM music  WHERE id = $1',
    'SELECT title, artist, genre, label FROM musics WHERE music_id = $1',
    'SELECT title, artist, genre, label FROM music  WHERE music_id = $1',
  ];
  for (const sql of candidates) {
    try {
      const r = await pool.query(sql, [musicId]); // <-- pool.query: 트랜잭션 아님
      if (r.rowCount > 0) return r.rows[0];
    } catch (e) {
      // 테이블/컬럼 불일치면 다음 후보 시도 (트랜잭션이 아니라 abort되지 않음)
    }
  }
  return null;
}

/**
 * POST /api/history
 * body: { user_id, photo_id, music_id, selected_from?('main'|'sub') }
 * 동작: (가능하면) music 메타 조회 → history 스냅샷 저장 (중복이면 갱신)
 */
router.post('/', async (req, res) => {
  let { user_id, photo_id, music_id, selected_from } = req.body || {};
  user_id = Number(user_id);
  photo_id = Number(photo_id);
  music_id = Number(music_id);
  const selectedFromNorm = normalizeSelectedFrom(selected_from);

  if (!user_id || !photo_id || !music_id) {
    return res.status(400).json({ error: 'user_id, photo_id, music_id are required' });
  }

  // 1) 메타는 트랜잭션 밖에서 미리 조회 (실패해도 진행)
  let title = null, artist = null, genre = null, label = null;
  try {
    const meta = await fetchMusicMetaSafe(music_id);
    if (meta) {
      title  = meta.title  ?? null;
      artist = meta.artist ?? null;
      genre  = meta.genre  ?? null;
      label  = meta.label  ?? null;
    }
  } catch (e) {
    // 어떤 이유로든 메타 조회 실패해도 계속 진행 (스냅샷 NULL)
    console.warn(`[history] meta fetch failed for music_id=${music_id}:`, e?.message || e);
  }

  // 2) 이제부터 트랜잭션 시작: 업서트만 수행
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 기존 row 조회 (락 걸어 충돌 방지)
    const existRes = await client.query(
      'SELECT history_id FROM history WHERE user_id=$1 AND photo_id=$2 AND music_id=$3 FOR UPDATE',
      [user_id, photo_id, music_id]
    );

    let saved;
    if (existRes.rowCount > 0) {
      const id = existRes.rows[0].history_id;
      const upRes = await client.query(
        `
        UPDATE history
           SET title_snapshot  = $1,
               artist_snapshot = $2,
               genre_snapshot  = $3,
               label_snapshot  = $4,
               selected_from   = COALESCE($5, selected_from),
               -- updated_at 컬럼이 있다면 아래 한 줄을 사용하세요.
               -- updated_at = NOW()
               created_at      = NOW()
         WHERE history_id = $6
         RETURNING history_id, user_id, photo_id, music_id,
                   title_snapshot AS title, artist_snapshot AS artist,
                   genre_snapshot AS genre, label_snapshot AS label,
                   selected_from, created_at
        `,
        [title, artist, genre, label, selectedFromNorm, id]
      );
      saved = upRes.rows[0];
    } else {
      const inRes = await client.query(
        `
        INSERT INTO history (
          user_id, photo_id, music_id,
          title_snapshot, artist_snapshot, genre_snapshot, label_snapshot,
          selected_from
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING history_id, user_id, photo_id, music_id,
                  title_snapshot AS title, artist_snapshot AS artist,
                  genre_snapshot AS genre, label_snapshot AS label,
                  selected_from, created_at
        `,
        [user_id, photo_id, music_id, title, artist, genre, label, selectedFromNorm]
      );
      saved = inRes.rows[0];
    }

    await client.query('COMMIT');
    return res.status(201).json(saved);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[API][POST /api/history] Error:', {
      code: err?.code, detail: err?.detail, message: err?.message,
    });
    return res.status(500).json({
      error: 'Failed to save history',
      details: err?.detail || err?.message || String(err),
    });
  } finally {
    client.release();
  }
});

/** GET /api/history?user_id=123 */
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
    console.error('[API][GET /api/history] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch history', details: String(err?.message || err) });
  }
});

/** 편집본 바이너리 */
router.get('/:id/edited-image/binary', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const { rows } = await pool.query(
      'SELECT edited_mime_type, edited_image FROM history WHERE history_id=$1',
      [id]
    );
    if (!rows[0] || !rows[0].edited_image) return res.status(404).send('Not found');

    res.set('Content-Type', rows[0].edited_mime_type || 'application/octet-stream');
    return res.send(rows[0].edited_image);
  } catch (e) {
    console.error('[API][GET /api/history/:id/edited-image/binary] Error:', e);
    return res.status(500).json({ error: 'binary failed', details: String(e?.message || e) });
  }
});

/** 편집본 업로드 */
router.post('/:id/edited-image', upload.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    if (!req.file) return res.status(400).json({ error: 'no file' });

    const { buffer, mimetype } = req.file;
    if (!/^image\/(png|webp|jpeg)$/.test(mimetype)) {
      return res.status(400).json({ error: 'image/png, image/webp, image/jpeg only' });
    }

    await pool.query(
      `UPDATE history
          SET edited_image=$1,
              edited_mime_type=$2,
              edited_at=NOW()
        WHERE history_id=$3`,
      [buffer, mimetype, id]
    );

    const base = `${req.protocol}://${req.get('host')}`;
    const editedUrl = `${base}/api/history/${id}/edited-image/binary`;

    return res.json({ edited_image_url: editedUrl });
  } catch (e) {
    console.error('[API][POST /api/history/:id/edited-image] Error:', e);
    return res.status(500).json({ error: 'upload failed', details: String(e?.message || e) });
  }
});

module.exports = router;
