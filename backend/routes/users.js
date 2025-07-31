const express = require('express');
const router = express.Router();
const pool = require('../db');

// 모든 사용자 조회
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

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