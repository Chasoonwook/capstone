// routes/feedback.js
const express = require("express");
const pool = require("../db");
const router = express.Router();

/**
 * 곡 단위 피드백 업서트
 * POST /api/feedback
 * body: { user_id, music_id, feedback: 1 | -1, photo_id?, context_main_mood?, context_sub_mood? }
 */
router.post("/feedback", async (req, res) => {
  const { user_id, music_id, feedback, photo_id, context_main_mood, context_sub_mood } = req.body || {};
  if (!user_id || !music_id || ![1, -1].includes(Number(feedback))) {
    return res.status(400).json({ error: "invalid payload" });
  }
  try {
    await pool.query(
      `INSERT INTO user_song_feedback (user_id, music_id, feedback, photo_id, context_main_mood, context_sub_mood)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, music_id)
       DO UPDATE SET feedback = EXCLUDED.feedback,
                     photo_id = EXCLUDED.photo_id,
                     context_main_mood = EXCLUDED.context_main_mood,
                     context_sub_mood  = EXCLUDED.context_sub_mood,
                     created_at = NOW()`,
      [user_id, music_id, feedback, photo_id ?? null, context_main_mood ?? null, context_sub_mood ?? null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[feedback]", e);
    res.status(500).json({ error: "feedback failed" });
  }
});

module.exports = router;
