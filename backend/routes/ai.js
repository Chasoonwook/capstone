const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * AI가 분석 결과를 업로드
 * body: { photo_id, time: "night", background: "natural", emotion: "angry" }
 * → mood_mapping 으로 main_mood/sub_mood 자동 매핑
 * 
 * AI 에서 POST 요청으로 /api/ai/results 로 보낼 수 있도록
 */

router.post('/results', async (req, res) => {
  try {
    const { photo_id, time, background, emotion } = req.body || {};
    if (!photo_id || !time || !background || !emotion) {
      return res.status(400).json({ error: 'photo_id, time, background, emotion are required' });
    }

    const key = `${time}-${background}-${emotion}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 매핑 조회
      const mapSql = `
        SELECT main_mood, sub_mood
        FROM mood_mapping
        WHERE time_label = $1 AND background = $2 AND emotion = $3
        LIMIT 1
      `;
      const mapRes = await client.query(mapSql, [time, background, emotion]);

      const main_mood = mapRes.rows[0]?.main_mood || null;
      const sub_mood  = mapRes.rows[0]?.sub_mood  || null;

      // 결과 upsert (photo_id는 UNIQUE)
      const upsertSql = `
        INSERT INTO photo_analysis (photo_id, time_label, background, emotion, main_mood, sub_mood)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (photo_id)
        DO UPDATE SET time_label=$2, background=$3, emotion=$4, main_mood=$5, sub_mood=$6, created_at=NOW()
        RETURNING *
      `;
      const upsertVals = [photo_id, time, background, emotion, main_mood, sub_mood];
      const { rows } = await client.query(upsertSql, upsertVals);

      await client.query('COMMIT');
      return res.json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('AI result save error:', e);
      return res.status(500).json({ error: 'AI result save failed' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('AI result outer error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;