const express = require('express');
const router = express.Router();
const pool = require('../db');

// 모든 추천 로그 조회
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, p.file_name, m.title, m.artist
       FROM recommendations r
       JOIN photo_history p ON r.photo_id = p.photo_id
       JOIN music m ON r.music_id = m.music_id
       ORDER BY r.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 특정 사진 추천 로그 조회
router.get('/photo/:photo_id', async (req, res) => {
  const { photo_id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM recommendations WHERE photo_id = $1', [photo_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 추천 추가
router.post('/', async (req, res) => {
  const { photo_id, music_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO recommendations (photo_id, music_id) VALUES ($1, $2) RETURNING *',
      [photo_id, music_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 추천 삭제
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM recommendations WHERE rec_id = $1', [id]);
    res.send('Recommendation deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;