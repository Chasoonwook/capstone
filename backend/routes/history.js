// routes/history.js
const express = require('express');
const pool = require('../db');
const multer = require('multer');
const axios = require('axios');

const router = express.Router();

// 환경 변수 설정
const REFRESH_RANKINGS_AFTER_SAVE = process.env.REFRESH_RANKINGS_AFTER_SAVE !== 'false';
const REFRESH_WAIT = process.env.REFRESH_WAIT === 'true';
const SKIP_META_LOOKUP = process.env.SKIP_META_LOOKUP === 'true';
const DEBUG_LOG_BODY = process.env.DEBUG_LOG_BODY === 'true';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// selected_from 정규화 
function normalizeSelectedFrom(v) {
  return v === 'main' || v === 'sub' ? v : null;
}

// 숫자 변환 
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 안전한 music 메타 조회 (실패 무시)
async function fetchMusicMetaSafe(musicId) {
  if (SKIP_META_LOOKUP) return null;

  const candidates = [
    'SELECT title, artist, genre, label FROM musics WHERE id = $1',
    'SELECT title, artist, genre, label FROM music  WHERE id = $1',
    'SELECT title, artist, genre, label FROM musics WHERE music_id = $1',
    'SELECT title, artist, genre, label FROM music  WHERE music_id = $1',
  ];
  for (const sql of candidates) {
    try {
      const r = await pool.query(sql, [musicId]); 
      if (r.rowCount > 0) return r.rows[0];
    } catch (e) {
      // 무시
    }
  }
  return null;
}

// 랭킹 갱신 트리거
async function triggerRefresh(req) {
  const BASE =
    process.env.BACKEND_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;

  // 타임아웃 30초
  await axios.post(`${BASE}/api/rankings/refresh`, {}, { timeout: 30000 });
}

// POST /api/history
// 기록 삽입
router.post('/', async (req, res) => {
  if (DEBUG_LOG_BODY) {
    try {
      const b = req.body || {};
      console.log(
        `[history.post] uid=${b?.user_id} mid=${b?.music_id} pid=${b?.photo_id} from=${b?.selected_from}`
      );
    } catch {}
  }

  let { user_id, photo_id, music_id, selected_from } = req.body || {};
  user_id = toInt(user_id);
  photo_id = toInt(photo_id);
  music_id = toInt(music_id);
  const selectedFromNorm = normalizeSelectedFrom(selected_from);

  if (!user_id || !photo_id || !music_id) {
    return res
      .status(400)
      .json({ error: 'user_id, photo_id, music_id are required (numbers)' });
  }

  // 트랜잭션 밖에서 메타 조회(실패 무시)
  let title = null,
    artist = null,
    genre = null,
    label = null;
  try {
    const meta = await fetchMusicMetaSafe(music_id);
    if (meta) {
      title = meta.title ?? null;
      artist = meta.artist ?? null;
      genre = meta.genre ?? null;
      label = meta.label ?? null;
    }
  } catch (e) {
    console.warn(
      `[history] meta fetch failed for music_id=${music_id}:`,
      e?.message || e
    );
  }

  // 트랜잭션 내 삽입
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    const saved = inRes.rows[0];

    await client.query('COMMIT');

    // 커밋 이후 랭킹 갱신 트리거
    let refreshed = false;
    if (REFRESH_RANKINGS_AFTER_SAVE) {
      if (REFRESH_WAIT) {

        try {
          await triggerRefresh(req);
          refreshed = true;
        } catch (e) {
          console.warn('[history] rankings refresh failed(wait):', e?.message || e);
        }
      } else {
        
        setImmediate(async () => {
          try {
            await triggerRefresh(req);
          } catch (e) {
            console.warn('[history] rankings refresh failed(async):', e?.message || e);
          }
        });
        refreshed = true; 
      }
    }

    return res.status(201).json({ ...saved, rankings_refreshed: refreshed });
  } catch (err) {
    await client.query('ROLLBACK');
    // 디버깅
    console.error('[API][POST /api/history] Insert failed', {
      code: err?.code,
      message: err?.message,
      detail: err?.detail,
      where: err?.where,
      schema: err?.schema,
      table: err?.table,
      column: err?.column,
      dataType: err?.dataType,
      constraint: err?.constraint,
      stack: err?.stack,
    });
    return res.status(500).json({
      error: 'Failed to save history',
      details: err?.detail || err?.message || String(err),
    });
  } finally {
    client.release();
  }
});

// GET /api/history
// 목록 조회
router.get('/', async (req, res) => {
  const userId = toInt(req.query.user_id);
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
    return res
      .status(500)
      .json({ error: 'Failed to fetch history', details: String(err?.message || err) });
  }
});

// 편집본 바이너리 조회
router.get('/:id/edited-image/binary', async (req, res) => {
  try {
    const id = toInt(req.params.id);
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

// 편집본 이미지 업로드
router.post('/:id/edited-image', upload.single('file'), async (req, res) => {
  try {
    const id = toInt(req.params.id);
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
