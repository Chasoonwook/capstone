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

    // 1. 분석된 분위기 정보 조회
    const { rows: aRows } = await pool.query(
      'SELECT main_mood, sub_mood FROM photo_analysis WHERE photo_id=$1',
      [photoId]
    );

    if (aRows.length === 0) {
      return res.status(404).json({ error: 'No analysis found for this photo_id' });
    }

    // 2. 분위기 값에서 ' 분위기' 문자열 제거
    let { main_mood, sub_mood } = aRows[0];
    main_mood = main_mood?.replace(' 분위기', '');
    sub_mood = sub_mood?.replace(' 분위기', '');

    // 분위기 매핑이 모두 비어있는 경우 예외 처리
    if (!main_mood && !sub_mood) {
      return res.status(409).json({ error: 'Mood mapping is missing for this photo' });
    }

    const result = {
      main_mood,
      sub_mood,
      main_songs: [],
      sub_songs: []
    };

    // 3. 메인 분위기에 해당하는 노래 최대 7곡 조회
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

    // 4. 서브 분위기에 해당하는 노래 최대 3곡 조회
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