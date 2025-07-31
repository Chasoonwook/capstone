const express = require('express');
const router = express.Router();
const pool = require('../db');

// 모든 사진 기록 조회
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM photo_history ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 특정 사용자 사진 조회
router.get('/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM photo_history WHERE user_id = $1', [user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 사진 기록 추가
router.post('/', async (req, res) => {
  const { user_id, file_path, file_name, labels, parameters, feedback } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO photo_history (user_id, file_path, file_name, labels, parameters, feedback) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [user_id, file_path, file_name, labels, parameters, feedback]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 사진 삭제
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM photo_history WHERE photo_id = $1', [id]);
    res.send('Photo deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;