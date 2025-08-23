// Backend/routes/onboarding.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * 선호 장르 저장
 * PUT /api/users/me/genres
 * body: { user_id?: number, genres: string[] }
 */
router.get('/users/me/onboarding', async (req, res) => {
  const userId =
    (req.user && req.user.id) ||
    req.headers['x-user-id'] ||
    req.query.user_id ||  // 옵션
    req.body?.user_id;    // 옵션

  if (!userId) return res.status(400).json({ error: 'user_id required' });

  try {
    const { rows } = await pool.query(
      `SELECT 
         COALESCE(genre_setup_complete, false) AS genre_setup_complete,
         COALESCE(preferred_genres, '[]'::jsonb) AS preferred_genres
       FROM users
       WHERE user_id = $1`,
      [userId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
    // 프론트가 기대하는 구조로 그대로 반환
    return res.json({
      genre_setup_complete: rows[0].genre_setup_complete,
      preferred_genres: rows[0].preferred_genres,
    });
  } catch (e) {
    console.error('get onboarding status error:', e);
    return res.status(500).json({ error: 'failed to get onboarding status' });
  }
});

router.put('/users/me/genres', async (req, res) => {
  const userId = (req.user && req.user.id) || req.body?.user_id || req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { genres } = req.body || {};
  if (!Array.isArray(genres) || genres.length < 2 || genres.length > 3) {
    return res.status(400).json({ error: 'genres must be array length 2~3' });
  }

  try {
    await pool.query(
      `UPDATE users SET preferred_genres = $1::jsonb WHERE user_id = $2`,
      [JSON.stringify(genres), userId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('save preferred_genres error:', e);
    res.status(500).json({ error: 'failed to save preferred_genres' });
  }
});

router.put('/users/me/onboarding', async (req, res) => {
  const userId = (req.user && req.user.id) || req.body?.user_id || req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { genre_setup_complete } = req.body || {};
  try {
    await pool.query(
      `UPDATE users SET genre_setup_complete = $1 WHERE user_id = $2`,
      [!!genre_setup_complete, userId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('onboarding flag error:', e);
    res.status(500).json({ error: 'failed to set onboarding flag' });
  }
});


module.exports = router;
