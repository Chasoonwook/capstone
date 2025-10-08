const express = require("express");
const router = express.Router();
const pool = require("../db");

/** ---------- (A) 프론트 조회: 주간 ---------- 
 * GET /api/rankings-simple/weekly?limit=50
 */
router.get("/weekly", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
  const sql = `
    WITH kst AS (
      SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst
    ),
    w AS (
      SELECT date_trunc('week', (SELECT now_kst FROM kst))::date AS week_start_kst
    )
    SELECT
      rw.rank,
      rw.music_id,
      rw.play_count,
      rw.last_played,
      m.title  AS music_title,
      m.artist AS music_artist,
      m.genre  AS music_genre,
      m.album_image AS album_image_url
    FROM ranking_weekly rw
    JOIN w ON rw.week_start = w.week_start_kst
    LEFT JOIN musics m ON m.id = rw.music_id
    ORDER BY rw.rank ASC
    LIMIT $1
  `;
  const { rows } = await pool.query(sql, [limit]);
  res.json({
    period: "weekly",
    items: rows,
  });
});

/** ---------- (B) 프론트 조회: 월간 ----------
 * GET /api/rankings-simple/monthly?limit=50
 */
router.get("/monthly", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
  const sql = `
    WITH kst AS (
      SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst
    ),
    m AS (
      SELECT date_trunc('month', (SELECT now_kst FROM kst))::date AS month_start_kst
    )
    SELECT
      rm.rank,
      rm.music_id,
      rm.play_count,
      rm.last_played,
      m2.title  AS music_title,
      m2.artist AS music_artist,
      m2.genre  AS music_genre,
      m2.album_image AS album_image_url
    FROM ranking_monthly rm
    JOIN m ON rm.month_start = m.month_start_kst
    LEFT JOIN musics m2 ON m2.id = rm.music_id
    ORDER BY rm.rank ASC
    LIMIT $1
  `;
  const { rows } = await pool.query(sql, [limit]);
  res.json({
    period: "monthly",
    items: rows,
  });
});

/** ---------- (C) 관리용: 집계 리프레시 ----------
 * POST /api/rankings-simple/refresh
 * (간단하게 보호하고 싶으면 헤더 토큰 체크)
 */
router.post("/refresh", async (req, res) => {
  try {
    await pool.query("BEGIN");

    // --- 주간 업서트 ---
    await pool.query(`
      WITH kst AS (
        SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst
      ),
      w AS (
        SELECT
          date_trunc('week', (SELECT now_kst FROM kst))::date AS week_start_kst,
          (date_trunc('week', (SELECT now_kst FROM kst)) + interval '7 day')::date AS week_end_kst
      ),
      agg AS (
        SELECT
          (SELECT week_start_kst FROM w) AS week_start,
          h.music_id,
          COUNT(*) AS play_count,
          MAX(h.created_at) AS last_played
        FROM history h
        JOIN w ON TRUE
        WHERE h.created_at >= (w.week_start_kst::timestamptz AT TIME ZONE 'Asia/Seoul')
          AND h.created_at <  (w.week_end_kst::timestamptz   AT TIME ZONE 'Asia/Seoul')
        GROUP BY h.music_id
      ),
      ranked AS (
        SELECT a.*,
               DENSE_RANK() OVER (ORDER BY a.play_count DESC, a.last_played DESC) AS rnk
        FROM agg a
      )
      INSERT INTO ranking_weekly (week_start, music_id, play_count, last_played, rank, generated_at)
      SELECT week_start, music_id, play_count, last_played, rnk, now()
      FROM ranked
      ON CONFLICT (week_start, music_id)
      DO UPDATE SET
        play_count   = EXCLUDED.play_count,
        last_played  = EXCLUDED.last_played,
        rank         = EXCLUDED.rank,
        generated_at = now();
    `);

    // --- 월간 업서트 ---
    await pool.query(`
      WITH kst AS (
        SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst
      ),
      m AS (
        SELECT
          date_trunc('month', (SELECT now_kst FROM kst))::date AS month_start_kst,
          (date_trunc('month', (SELECT now_kst FROM kst)) + interval '1 month')::date AS month_end_kst
      ),
      agg AS (
        SELECT
          (SELECT month_start_kst FROM m) AS month_start,
          h.music_id,
          COUNT(*) AS play_count,
          MAX(h.created_at) AS last_played
        FROM history h
        JOIN m ON TRUE
        WHERE h.created_at >= (m.month_start_kst::timestamptz AT TIME ZONE 'Asia/Seoul')
          AND h.created_at <  (m.month_end_kst::timestamptz   AT TIME ZONE 'Asia/Seoul')
        GROUP BY h.music_id
      ),
      ranked AS (
        SELECT a.*,
               DENSE_RANK() OVER (ORDER BY a.play_count DESC, a.last_played DESC) AS rnk
        FROM agg a
      )
      INSERT INTO ranking_monthly (month_start, music_id, play_count, last_played, rank, generated_at)
      SELECT month_start, music_id, play_count, last_played, rnk, now()
      FROM ranked
      ON CONFLICT (month_start, music_id)
      DO UPDATE SET
        play_count   = EXCLUDED.play_count,
        last_played  = EXCLUDED.last_played,
        rank         = EXCLUDED.rank,
        generated_at = now();
    `);

    await pool.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await pool.query("ROLLBACK");
    console.error("[rankings-simple/refresh]", e);
    res.status(500).json({ ok: false, error: "refresh_failed" });
  }
});

module.exports = router;