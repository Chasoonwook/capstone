// Backend/routes/musicRequests.js
const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * POST /api/music-requests
 * body: { title: string, artist: string, requested_by?: string }
 * 동작: (norm_title, norm_artist) 유니크 키로 UPSERT → 중복이면 request_count 증가
 */
router.post('/', async (req, res) => {
  try {
    const rawTitle = String(req.body?.title || '').trim();
    const rawArtist = String(req.body?.artist || '').trim();
    const requested_by = req.body?.requested_by ? String(req.body.requested_by).trim() : null;

    if (!rawTitle || !rawArtist) {
      return res.status(400).json({ error: 'title and artist are required' });
    }

    const norm_title = rawTitle.toLowerCase();
    const norm_artist = rawArtist.toLowerCase();

    const upsertSql = `
      INSERT INTO music_requests
        (title, artist, requested_by, request_count, last_requested_at, norm_title, norm_artist)
      VALUES ($1, $2, $3, 1, now(), $4, $5)
      ON CONFLICT (norm_title, norm_artist)
      DO UPDATE SET
        request_count     = music_requests.request_count + 1,
        last_requested_at = now(),
        -- 최신 원본 텍스트로 덮어쓰고 싶으면 유지, 아니면 주석 처리
        title             = EXCLUDED.title,
        artist            = EXCLUDED.artist,
        requested_by      = COALESCE(EXCLUDED.requested_by, music_requests.requested_by)
      RETURNING request_id, title, artist, requested_by, status, request_count, last_requested_at, created_at
    `;

    const { rows } = await pool.query(upsertSql, [
      rawTitle,
      rawArtist,
      requested_by,
      norm_title,
      norm_artist,
    ]);

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[music-requests][create]', err);
    return res.status(500).json({ error: 'Failed to create music request' });
  }
});

/**
 * GET /api/music-requests
 * (관리자용) 최근/인기 요청 보기 (요청 수 내림차순 → 최신순)
 */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT request_id, title, artist, requested_by, status,
              request_count, last_requested_at, created_at
         FROM music_requests
        ORDER BY request_count DESC, last_requested_at DESC
        LIMIT 200`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[music-requests][list]', err);
    return res.status(500).json({ error: 'Failed to fetch music requests' });
  }
});

router.get('/count', async (req, res) => {
  try {
    const rawTitle = String(req.query.title || '').trim();
    const rawArtist = String(req.query.artist || '').trim();
    if (!rawTitle || !rawArtist) {
      return res.status(400).json({ error: 'title and artist are required' });
    }

    const norm_title = rawTitle.toLowerCase();
    const norm_artist = rawArtist.toLowerCase();

    const { rows } = await pool.query(
      `SELECT request_count
         FROM music_requests
        WHERE norm_title = $1 AND norm_artist = $2
        LIMIT 1`,
      [norm_title, norm_artist]
    );

    const count = rows[0]?.request_count ?? 0;
    return res.json({ request_count: count });
  } catch (err) {
    console.error('[music-requests][count]', err);
    return res.status(500).json({ error: 'Failed to fetch request count' });
  }
});

module.exports = router;
