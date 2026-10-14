const express = require('express');
const router = express.Router();
const pool = require('../db');

// 모든 음악 조회
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM music ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 특정 라벨 음악 조회
router.get('/label/:label', async (req, res) => {
  const { label } = req.params;
  try {
    const result = await pool.query('SELECT * FROM music WHERE label = $1', [label]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 음악 추가
router.post('/', async (req, res) => {
  const { title, artist, label, genre } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO music (title, artist, label, genre) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, artist, label, genre]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 음악 삭제
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM music WHERE music_id = $1', [id]);
    res.send('Music deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// GET /api/musics/by-mood?label
// 특정 분위기 라벨의 음악들 조회
router.get("/by-mood", async (req, res) => {
  const label = String(req.query.label || "");
  const limit = Number(req.query.limit || 7);
  if (!label) return res.status(400).json({ error: "label required" });
  const { rows } = await pool.query(
    `SELECT id as music_id, title, artist, label, genre, duration
     FROM music
     WHERE label = $1
     ORDER BY RANDOM()
     LIMIT $2`,
    [label, limit]
  );
  res.json(rows);
});


module.exports = router;