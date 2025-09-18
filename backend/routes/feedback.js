// routes/feedback.js
const express = require("express");
const pool = require("../db");
const auth = require("./auth");              // auth 라우터 모듈
const authRequired = auth.authRequired;      // 미들웨어 참조

const router = express.Router();

/**
 * 곡 단위 피드백 업서트
 * POST /api/feedback
 * body: { music_id, feedback: 1 | -1, photo_id?, context_main_mood?, context_sub_mood? }
 * - user_id는 body에 안 보냄 (토큰에서 추출)
 */
router.post("/feedback", authRequired, async (req, res) => {
  try {
    // 1) 토큰에서 사용자
    const userId = Number(req.auth?.sub);
    if (!userId) return res.status(401).json({ error: "missing user" });

    // 2) payload 검증
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

    // 3) 업서트 (타임스탬프 컬럼 업데이트 제거)
    await pool.query(
      `INSERT INTO user_song_feedback
         (user_id, music_id, feedback, photo_id, context_main_mood, context_sub_mood)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, music_id)
       DO UPDATE SET
         feedback = EXCLUDED.feedback,
         photo_id = EXCLUDED.photo_id,
         context_main_mood = EXCLUDED.context_main_mood,
         context_sub_mood  = EXCLUDED.context_sub_mood`,
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
    // 디버깅 도움: 서버 콘솔에 자세히 남기기
    console.error("[feedback] upsert error:", e && (e.stack || e.message || e));
    return res.status(500).json({ error: "feedback failed" });
  }
});

module.exports = router;
