const express = require('express');
const router = express.Router();
const pool = require('../db');

/** 공통: 요청에서 userId 추출 */
function getUserId(req) {
  return (
    (req.user && req.user.id) ||
    req.headers['x-user-id'] ||
    req.query.user_id ||
    req.body?.user_id
  );
}

/**
 * ⚠️ '/:id' 보다 반드시 위에 둡니다.
 * GET /api/users/me
 */
router.get('/me', async (req, res) => {
  const userIdRaw = getUserId(req);
  if (!userIdRaw) {
    return res.status(401).json({ error: 'unauthorized: user_id required' });
  }
  const userId = String(userIdRaw).trim();

  try {
    // ⬇️ 캐스팅 없이 원시 컬럼만 선택 (타입이 지역/배포 DB마다 달라도 안전)
    const { rows } = await pool.query(
      `
      SELECT
        user_id,
        email,
        name,
        preferred_genres,        -- <-- jsonb, text, text[], json 문자열 등 무엇이든 원시로 가져옴
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

    // ---- JS에서만 안전 파싱 ----
    let genres = [];
    try {
      const raw = me.preferred_genres;

      if (Array.isArray(raw)) {
        // jsonb 배열 혹은 text[]인 경우
        genres = raw.map(String);
      } else if (raw && typeof raw === 'object') {
        // jsonb object로 오는 드라이버 케이스 (드물지만 대비)
        const v = Array.isArray(raw.value) ? raw.value : raw;
        genres = Array.isArray(v) ? v.map(String) : [];
      } else if (typeof raw === 'string') {
        // 문자열인 경우: JSON 문자열일 수도 있고, 콤마구분 텍스트일 수도 있음
        let parsed = [];
        try {
          parsed = JSON.parse(raw); // JSON 문자열이면 여기서 파싱
        } catch {
          // 콤마구분 "K-pop,Pop" 같은 경우를 대비
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
    console.error('GET /users/me error:', err); // 실제 에러 로그 확인용
    return res.status(500).json({ error: 'failed to get me' });
  }
});

/**
 * (옵션) 선호 장르 저장
 * PUT /api/users/me/genres
 * - DB 타입이 jsonb이든 text이든 상관없이 저장되도록 통일해서 문자열(JSON)로 넣습니다.
 */
router.put('/me/genres', async (req, res) => {
  const userIdRaw = getUserId(req);
  if (!userIdRaw) return res.status(400).json({ error: 'user_id required' });
  const userId = String(userIdRaw).trim();

  const { genres } = req.body || {};
  if (!Array.isArray(genres) || genres.length < 1 || genres.length > 10) {
    return res.status(400).json({ error: 'genres must be array length 1~10' });
  }

  try {
    // 어떤 타입이든 안전하게 저장: 문자열(JSON)로 저장
    // - jsonb 컬럼이면 PG가 text->jsonb 캐스팅 해줍니다: $1::jsonb 사용
    // - text 컬럼이어도 문제 없음: 그냥 JSON 문자열로 저장됨
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

// ===== 기존 라우트 유지 =====
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

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
