const express = require('express');
const router = express.Router();
const pool = require('../db');

// 공통으로 user_id 추출하는 함수
function getUserId(req) {
  return (
    (req.user && req.user.id) ||
    req.headers['x-user-id'] ||
    req.query.user_id ||
    req.body?.user_id
  );
}

// GET /api/users/me
// 계정 정보 조회
router.get('/me', async (req, res) => {
  const userIdRaw = getUserId(req);
  if (!userIdRaw) {
    return res.status(401).json({ error: 'unauthorized: user_id required' });
  }
  const userId = String(userIdRaw).trim();

  try {
    // DB에서 사용자 정보 조회
    const { rows } = await pool.query(
      `
      SELECT
        user_id,
        email,
        name,
        preferred_genres,        
        genre_setup_complete
      FROM users
      WHERE user_id = $1
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'user not found' });
    }

    const me = rows[0];

    // preferred_genres 파싱 
    let genres = [];
    try {
      const raw = me.preferred_genres;

      if (Array.isArray(raw)) {
        // jsonb 배열 혹은 text[]인 경우
        genres = raw.map(String);
      } else if (raw && typeof raw === 'object') {
        // jsonb object로 오는 드라이버 케이스 
        const v = Array.isArray(raw.value) ? raw.value : raw;
        genres = Array.isArray(v) ? v.map(String) : [];
      } else if (typeof raw === 'string') {
        // 문자열인 경우
        let parsed = [];
        try {
          parsed = JSON.parse(raw); // JSON 문자열 파싱시도
        } catch {
          parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
        }
        genres = Array.isArray(parsed) ? parsed.map(String) : [];
      } else if (raw == null) {
        genres = [];
      }
    } catch (e) {
      console.error('[users/me] preferred_genres parse error:', e, { raw: me.preferred_genres });
      genres = [];
    }

    return res.json({
      id: me.user_id,
      email: me.email || null,
      name: me.name || null,
      preferred_genres: genres,
      genre_setup_complete: !!me.genre_setup_complete,
    });
  } catch (err) {
    console.error('GET /users/me error:', err); 
    return res.status(500).json({ error: 'failed to get me' });
  }
});

// PUT /api/users/me/genres
// 선호 장르 저장
router.put('/me/genres', async (req, res) => {
  const userIdRaw = getUserId(req);
  if (!userIdRaw) return res.status(400).json({ error: 'user_id required' });
  const userId = String(userIdRaw).trim();

  const { genres } = req.body || {};
  if (!Array.isArray(genres) || genres.length < 1 || genres.length > 10) {
    return res.status(400).json({ error: 'genres must be array length 1~10' });
  }

  try {
    // 어떤 타입이든 문자열(JSON)로 저장
    await pool.query(
      `UPDATE users SET preferred_genres = $1 WHERE user_id = $2`,
      [JSON.stringify(genres.map(String)), userId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT /users/me/genres error:', err);
    return res.status(500).json({ error: 'failed to save preferred_genres' });
  }
});

// GET /api/users
// 사용자 목록 조회
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// GET /api/users/:id
// 특정 사용자 조회
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).send('User not found');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// POST /api/users
// 사용자 추가
router.post('/', async (req, res) => {
  const { name, email, password, gender, phone } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO users (name, email, password, gender, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, email, password, gender, phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// DELETE /api/users/:id
// 사용자 삭제
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE user_id = $1', [id]);
    res.send('User deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
