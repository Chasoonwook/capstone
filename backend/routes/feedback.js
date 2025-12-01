// routes/feedback.js
const express = require("express");
const pool = require("../db");
const auth = require("./auth");              
const authRequired = auth.authRequired;      

const router = express.Router();

// POST /api/feedback
// 사용자 곡 피드백 업서트
router.post("/feedback", authRequired, async (req, res) => {
  try {
    // 토큰에서 사용자
    const userId = Number(req.auth?.sub);
    if (!userId) return res.status(401).json({ error: "missing user" });

    // payload 검증
    const {
      music_id,
      feedback,
      photo_id,
      context_main_mood,
      context_sub_mood,
    } = req.body || {};

    const musicId = Number(music_id);
    const fb = Number(feedback);

    if (!Number.isFinite(musicId) || ![1, -1].includes(fb)) {
      return res.status(400).json({ error: "invalid payload" });
    }

    // 업서트 수행
    await pool.query(
      `INSERT INTO user_song_feedback
         (user_id, music_id, feedback, photo_id, context_main_mood, context_sub_mood)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, music_id, photo_id)
       DO UPDATE SET
         feedback = EXCLUDED.feedback,
         context_main_mood = EXCLUDED.context_main_mood,
         context_sub_mood  = EXCLUDED.context_sub_mood,
         created_at = NOW()`,
      [
        userId,
        musicId,
        fb,
        photo_id ?? null,
        context_main_mood ?? null,
        context_sub_mood ?? null,
      ]
    );

    return res.json({ ok: true });
  } catch (e) {
    // 오류 처리
    console.error("[feedback] upsert error:", e && (e.stack || e.message || e));
    return res.status(500).json({ error: "feedback failed" });
  }
});

module.exports = router;
