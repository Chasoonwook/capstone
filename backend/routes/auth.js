// Backend/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = '7d';

const trim = (s) => (s ?? '').toString().trim();

/* -------------------- REGISTER -------------------- */
/**
 * POST /api/auth/register
 * body: { name, email, password, gender?, phone? }
 */
router.post('/register', async (req, res) => {
  try {
    const name = trim(req.body?.name);
    const email = trim(req.body?.email);
    const password = req.body?.password || '';
    const gender = req.body?.gender ?? null;   // 현재 DB가 한글도 허용하므로 그대로 저장
    const phone  = req.body?.phone  ?? null;   // 하이픈 포함되어도 TEXT면 OK

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, password are required' });
    }

    // 이메일 중복 (대소문자 무시)
    const { rows: dup } = await pool.query(
      'SELECT 1 FROM users WHERE lower(email)=lower($1) LIMIT 1',
      [email]
    );
    if (dup.length) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, gender, phone, genre_setup_complete)
       VALUES ($1,$2,$3,$4,$5,false)
       RETURNING user_id AS id, name, email, COALESCE(genre_setup_complete,false) AS genre_setup_complete`,
      [name, email, hash, gender, phone]
    );

    const user = rows[0];
    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
      onboarding_done: false,
      genre_setup_complete: user.genre_setup_complete,
    });
  } catch (err) {
    console.error('[REGISTER ERROR]', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    if (err.code && err.code.startsWith('23')) return res.status(400).json({ error: 'Invalid data for insert' });
    return res.status(500).json({ error: 'Register failed' });
  }
});

/* -------------------- LOGIN -------------------- */
/**
 * POST /api/auth/login
 * body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const email = trim(req.body?.email);
    const password = req.body?.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: 'email, password required' });
    }

    const { rows } = await pool.query(
      `SELECT user_id AS id, name, email, password_hash,
              COALESCE(genre_setup_complete,false) AS genre_setup_complete,
              COALESCE(onboarding_done,false)        AS onboarding_done
         FROM users
        WHERE lower(email)=lower($1)
        LIMIT 1`,
      [email]
    );

    if (!rows.length) return res.status(404).json({ error: 'not found' });

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid password' });

    const token = jwt.sign({ sub: u.id, email: u.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({
      token,
      user: { id: u.id, name: u.name, email: u.email },
      onboarding_done: u.onboarding_done,
      genre_setup_complete: u.genre_setup_complete,
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
