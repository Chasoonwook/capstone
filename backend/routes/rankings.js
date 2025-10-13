const express = require("express");
const router = express.Router();
const pool = require("../db");
const axios = require("axios");

/** ──────────────────────────────────────────────────────────────
 * 1) 공통 유틸
 * ──────────────────────────────────────────────────────────────*/

/** 1~100 보정 */
function clampLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(n, 100));
}

/** Spotify Client Credentials (환경변수 필요) */
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let _spToken = null;
let _spTokenExp = 0; // epoch ms

async function getSpotifyAccessToken() {
  const now = Date.now();
  if (_spToken && now < _spTokenExp - 5000) return _spToken;

  const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");

  const r = await axios.post("https://accounts.spotify.com/api/token", params, {
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  _spToken = r.data.access_token;
  // 만료 3600초 기준, 55분 정도로 여유
  _spTokenExp = now + (r.data.expires_in ? (r.data.expires_in - 120) * 1000 : 55 * 60 * 1000);
  return _spToken;
}

/** 간단한 인메모리 커버 이미지 캐시 (프로세스 생명주기 동안) */
const coverCache = new Map(); // key: `${title}__${artist}` → url

function makeCoverKey(title, artist) {
  return `${(title || "").trim().toLowerCase()}__${(artist || "").trim().toLowerCase()}`;
}

/** Spotify에서 트랙 커버(앨범 이미지) 1장 가져오기 */
async function fetchSpotifyCoverUrl(title, artist) {
  if (!title) return null;

  const key = makeCoverKey(title, artist);
  const cached = coverCache.get(key);
  if (cached !== undefined) return cached; // 캐시 hit (null도 캐시)

  try {
    const token = await getSpotifyAccessToken();
    // q를 최대한 보수적으로: track + artist
    const qParts = [];
    qParts.push(`track:${JSON.stringify(title)}`);
    if (artist) qParts.push(`artist:${JSON.stringify(artist)}`);
    const q = qParts.join(" ");

    const r = await axios.get("https://api.spotify.com/v1/search", {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, type: "track", limit: 1 },
      timeout: 5000,
    });

    const items = r.data?.tracks?.items || [];
    let url = null;
    if (items.length > 0) {
      const albumImages = items[0]?.album?.images || [];
      // 큰→작은 순으로 오므로 [0] 우선
      url = albumImages[0]?.url || albumImages[1]?.url || albumImages[2]?.url || null;
    }
    coverCache.set(key, url ?? null);
    return url ?? null;
  } catch (e) {
    // 에러 시 null 캐시해서 과도한 재시도 방지
    coverCache.set(key, null);
    return null;
  }
}

/** 주간/월간 공통: rows + (필요 시) 커버 이미지 조회 */
async function attachCovers(items) {
  // title/artist 조합을 모아서 병렬 조회 (중복 제거)
  const pairs = new Map(); // key -> { title, artist }
  for (const it of items) {
    const key = makeCoverKey(it.music_title, it.music_artist);
    if (!pairs.has(key)) pairs.set(key, { title: it.music_title, artist: it.music_artist });
  }

  // 병렬 요청
  const entries = Array.from(pairs.entries());
  await Promise.all(
    entries.map(async ([key, { title, artist }]) => {
      const url = await fetchSpotifyCoverUrl(title, artist);
      pairs.set(key, { title, artist, url });
    })
  );

  // 매핑 반영
  return items.map((it) => {
    const key = makeCoverKey(it.music_title, it.music_artist);
    const found = pairs.get(key);
    return {
      ...it,
      album_image_url: found?.url ?? null,
    };
  });
}

/** ──────────────────────────────────────────────────────────────
 * 2) 주간 차트
 *    - ranking_weekly ⟶ (music_id) ⟶ music 테이블 조인
 *    - title, artist 컬럼 붙여서 반환
 *    - 앨범 커버는 Spotify에서 조회
 * ──────────────────────────────────────────────────────────────*/
/**
 * GET /api/rankings/weekly?limit=50
 */
router.get("/weekly", async (req, res) => {
  const limit = clampLimit(req.query.limit);

  // 1) 이번 주(Asia/Seoul) 기준 주차
  // 2) ranking_weekly에 이번 주가 비어 있으면 가장 최근 주차로 폴백
  const sql = `
    WITH kst AS (
      SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst
    ),
    this_week AS (
      SELECT date_trunc('week', (SELECT now_kst FROM kst))::date AS week_start_kst
    ),
    target_week AS (
      SELECT
        -- 이번 주 데이터가 있으면 이번 주, 없으면 가장 최근 주차를 선택
        COALESCE(
          (SELECT tw.week_start_kst
             FROM this_week tw
             WHERE EXISTS (
               SELECT 1
               FROM ranking_weekly rw0
               WHERE (rw0.week_start::date) = tw.week_start_kst
             )
          ),
          (SELECT (rw1.week_start::date)
             FROM ranking_weekly rw1
             ORDER BY (rw1.week_start::date) DESC
             LIMIT 1
          )
        ) AS week_start_kst
    )
    SELECT
      rw.rank,
      rw.music_id,
      rw.play_count,
      rw.last_played,
      m.title  AS music_title,
      m.artist AS music_artist
    FROM ranking_weekly rw
    JOIN target_week tw
      ON (rw.week_start::date) = tw.week_start_kst
    LEFT JOIN music m
      ON m.music_id = rw.music_id
    ORDER BY rw.rank ASC
    LIMIT $1
  `;

  try {
    const { rows } = await pool.query(sql, [limit]);

    // Spotify 커버 붙이기 (attachCovers는 기존 함수 재사용)
    const withCovers = await attachCovers(
      rows.map((r) => ({
        rank: r.rank,
        music_id: r.music_id,
        play_count: r.play_count,
        last_played: r.last_played,
        music_title: r.music_title ?? null,
        music_artist: r.music_artist ?? null,
        music_genre: null,
        album_image_url: null,
      }))
    );

    res.json({ period: "weekly", items: withCovers });
  } catch (e) {
    console.error("[rankings/weekly] error:", e);
    res.status(500).json({ error: "weekly_failed" });
  }
});

/** ──────────────────────────────────────────────────────────────
 * 3) 월간 차트
 *    - ranking_monthly ⟶ (music_id) ⟶ music 테이블 조인
 *    - title, artist 컬럼 붙여서 반환
 *    - 앨범 커버는 Spotify에서 조회
 * ──────────────────────────────────────────────────────────────*/
/**
 * GET /api/rankings/monthly?limit=50
 */
router.get("/monthly", async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const sql = `
    WITH kst AS (
      SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst
    ),
    mon AS (
      SELECT date_trunc('month', (SELECT now_kst FROM kst))::date AS month_start_kst
    )
    SELECT
      rm.rank,
      rm.music_id,
      rm.play_count,
      rm.last_played,
      m.title    AS music_title,
      m.artist   AS music_artist
    FROM ranking_monthly rm
    JOIN mon ON rm.month_start = mon.month_start_kst
    LEFT JOIN music m ON m.music_id = rm.music_id
    ORDER BY rm.rank ASC
    LIMIT $1
  `;
  try {
    const { rows } = await pool.query(sql, [limit]);

    // 커버 붙이기
    const withCovers = await attachCovers(
      rows.map((r) => ({
        rank: r.rank,
        music_id: r.music_id,
        play_count: r.play_count,
        last_played: r.last_played,
        music_title: r.music_title ?? null,
        music_artist: r.music_artist ?? null,
        music_genre: null,          // 필요 시 music 테이블에서 추가
        album_image_url: null,      // attachCovers에서 채워짐
      }))
    );

    res.json({ period: "monthly", items: withCovers });
  } catch (e) {
    console.error("[rankings/monthly] failed:", e);
    res.status(500).json({ error: "monthly_query_failed" });
  }
});

/** ──────────────────────────────────────────────────────────────
 * 4) 집계 리프레시 (기존 그대로 보존)
 * ──────────────────────────────────────────────────────────────*/
/**
 * POST /api/rankings/refresh
 */
router.post("/refresh", async (req, res) => {
  try {
    await pool.query("BEGIN");

    // --- 주간 업서트 ---
    await pool.query(`
      WITH kst AS ( SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst ),
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
      WITH kst AS ( SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst ),
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
    console.error("[rankings/refresh]", e);
    res.status(500).json({ ok: false, error: "refresh_failed" });
  }
});

module.exports = router;
