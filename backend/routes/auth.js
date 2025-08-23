// Backend/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = '7d';

/**
 * POST /api/auth/register
 * body: { name, email, password, gender?, phone? }
 */
router.post('/register', async (req, res) => {
  const { name, email, password, gender, phone } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, password are required' });
  }

  try {
    // 이메일 중복 체크
    const { rows: exist } = await pool.query(
      'SELECT 1 FROM users WHERE email=$1 LIMIT 1',
      [email]
    );
    if (exist.length) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);

    // ⚠️ users 테이블에 없는 컬럼을 넣으면 500이 납니다.
    // gender/phone 컬럼이 없으면 아래 INSERT에서 제외하세요.
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password, gender, phone, genre_setup_complete)
       VALUES ($1,$2,$3,$4,$5,false)
       RETURNING user_id AS id, name, email`,
      [name, email, hash, gender ?? null, phone ?? null]
    );

    const user = rows[0];
    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({ token, user, onboarding_done: false });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Register failed' });
  }
});

/**
 * POST /api/auth/login
 * body: { email, password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email, password required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT user_id AS id, name, email, password, COALESCE(genre_setup_complete,false) AS done
       FROM users WHERE email=$1 LIMIT 1`,
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({ token, user, onboarding_done: rows[0].done });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
