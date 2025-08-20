// routes/recommendations.js
const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * 사진 ID로 추천 묶음 조회
 * - main_mood: 7곡 (label = main_mood)
 * - sub_mood : 3곡 (label = sub_mood)
 */
router.get('/by-photo/:photoId', async (req, res) => {
  try {
    const { photoId } = req.params;

    const { rows: aRows } = await pool.query(
      'SELECT main_mood, sub_mood FROM photo_analysis WHERE photo_id=$1',
      [photoId]
    );
    if (aRows.length === 0) {
      return res.status(404).json({ error: 'No analysis found for this photo_id' });
    }

    const { main_mood, sub_mood } = aRows[0];
    if (!main_mood && !sub_mood) {
      return res.status(409).json({ error: 'Mood mapping is missing for this photo' });
    }

    const result = {
      main_mood,
      sub_mood,
      main_songs: [],
      sub_songs: []
    };

    if (main_mood) {
      const { rows: mainSongs } = await pool.query(
        `SELECT music_id, title, artist, label, genre, created_at
         FROM music
         WHERE label = $1
         ORDER BY created_at DESC, music_id DESC
         LIMIT 7`,
        [main_mood]
      );
      result.main_songs = mainSongs;
    }

    if (sub_mood) {
      const { rows: subSongs } = await pool.query(
        `SELECT music_id, title, artist, label, genre, created_at
         FROM music
         WHERE label = $1
         ORDER BY created_at DESC, music_id DESC
         LIMIT 3`,
        [sub_mood]
      );
      result.sub_songs = subSongs;
    }

    res.json(result);
  } catch (err) {
    console.error('Recommendation error:', err);
    res.status(500).json({ error: 'Recommendation failed' });
  }
});

module.exports = router;