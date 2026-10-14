const express = require("express");
const router = express.Router();
const pool = require("../db");
const axios = require("axios");

// 공통 상수
function clampLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(n, 100));
}

// Spotify 커버 이미지 조회 관련
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let _spToken = null;
let _spTokenExp = 0;

async function getSpotifyAccessToken() {
  const now = Date.now();
  if (_spToken && now < _spTokenExp - 5000) return _spToken;

  const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");

  const r = await axios.post("https://accounts.spotify.com/api/token", params, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 10000,
  });

  _spToken = r.data.access_token;
  _spTokenExp = now + (r.data.expires_in ? (r.data.expires_in - 120) * 1000 : 55 * 60 * 1000);
  return _spToken;
}

// Spotify 커버 이미지 캐시 및 조회
const coverCache = new Map(); 
const makeCoverKey = (title, artist) =>
  `${(title || "").trim().toLowerCase()}__${(artist || "").trim().toLowerCase()}`;

async function fetchSpotifyCoverUrl(title, artist) {
  if (!title) return null;

  const key = makeCoverKey(title, artist);
  if (coverCache.has(key)) return coverCache.get(key);

  try {
    const token = await getSpotifyAccessToken();
    const qParts = [];
    qParts.push(`track:${JSON.stringify(title)}`);
    if (artist) qParts.push(`artist:${JSON.stringify(artist)}`);
    const q = qParts.join(" ");

    const r = await axios.get("https://api.spotify.com/v1/search", {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, type: "track", limit: 1 },
      timeout: 6000,
    });

    const items = r.data?.tracks?.items || [];
    let url = null;
    if (items.length > 0) {
      const imgs = items[0]?.album?.images || [];
      url = imgs[0]?.url || imgs[1]?.url || imgs[2]?.url || null;
    }
    coverCache.set(key, url);
    return url;
  } catch {
    coverCache.set(key, null);
    return null;
  }
}

// 여러 항목에 커버 이미지 첨부
async function attachCovers(items) {
  const uniqPairs = new Map();
  for (const it of items) {
    const k = makeCoverKey(it.music_title, it.music_artist);
    if (!uniqPairs.has(k)) uniqPairs.set(k, { title: it.music_title, artist: it.music_artist });
  }
  const entries = Array.from(uniqPairs.entries());
  await Promise.all(
    entries.map(async ([k, { title, artist }]) => {
      const url = await fetchSpotifyCoverUrl(title, artist);
      uniqPairs.set(k, { title, artist, url });
    })
  );
  return items.map((it) => {
    const k = makeCoverKey(it.music_title, it.music_artist);
    const found = uniqPairs.get(k);
    return { ...it, album_image_url: found?.url ?? null };
  });
}

// 안전한 음악 메타 조회 
async function detectMusicMeta() {
  const candidates = ['musics', 'music', 'songs'];

  const q = `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
  `;
  const { rows } = await pool.query(q, [candidates]);
  if (!rows?.length) return null;

  const byTable = new Map();
  for (const r of rows) {
    const name = r.table_name;
    if (!byTable.has(name)) byTable.set(name, new Set());
    byTable.get(name).add(r.column_name);
  }

  for (const t of candidates) {
    const cols = byTable.get(t);
    if (!cols) continue;

    const hasId = cols.has('music_id') || cols.has('id');
    const hasTitle = cols.has('title');
    const hasArtist = cols.has('artist');

    if (!hasId || !hasTitle || !hasArtist) continue;

    const genreCol = cols.has('genre') ? 'genre' : null;
    const albumCol = cols.has('album_image_url')
      ? 'album_image_url'
      : (cols.has('album_image') ? 'album_image' : null);

    return {
      table: t,
      idCol: cols.has('music_id') ? 'music_id' : 'id',
      titleCol: 'title',
      artistCol: 'artist',
      genreCol,
      albumCol,
    };
  }

  return null;
}

// 음악 메타 맵 조회
// id 배열 → Map(id → {title, artist, genre, album_image_url})
async function fetchMusicMetaMap(ids) {
  const uniq = Array.from(new Set(ids)).filter(v => Number.isFinite(Number(v)));
  if (uniq.length === 0) return new Map();

  const meta = await detectMusicMeta();
  if (!meta) return new Map();

  const identOk = /^[a-z_]+$/.test(meta.table)
               && /^[a-z_]+$/.test(meta.idCol)
               && /^[a-z_]+$/.test(meta.titleCol)
               && /^[a-z_]+$/.test(meta.artistCol)
               && (!meta.genreCol  || /^[a-z_]+$/.test(meta.genreCol))
               && (!meta.albumCol  || /^[a-z_]+$/.test(meta.albumCol));
  if (!identOk) return new Map();

  const sql = `
    SELECT
      ${meta.idCol}   AS id,
      ${meta.titleCol}  AS title,
      ${meta.artistCol} AS artist
      ${meta.genreCol ? `, ${meta.genreCol} AS genre` : ``}
      ${meta.albumCol ? `, ${meta.albumCol} AS album_image_url` : ``}
    FROM ${meta.table}
    WHERE ${meta.idCol} = ANY($1)
  `;

  try {
    const { rows } = await pool.query(sql, [uniq]);
    const map = new Map();
    rows.forEach(r => {
      map.set(Number(r.id), {
        title: r.title ?? null,
        artist: r.artist ?? null,
        genre: r.genre ?? null,
        album_image_url: r.album_image_url ?? null,
      });
    });
    return map;
  } catch (e) {
    console.warn("[rankings] meta fetch skipped:", e.message);
    return new Map();
  }
}

// DB 행과 메타 병합
function mergeRowsWithMeta(rows, metaMap) {
  return rows.map((r) => {
    const mm = metaMap.get(Number(r.music_id)) || {};
    return {
      rank: r.rank,
      music_id: r.music_id,
      play_count: r.play_count,
      last_played: r.last_played,
      rank_change: r.rank_change ?? null,
      music_title: mm.title ?? null,
      music_artist: mm.artist ?? null,
      music_genre: mm.genre ?? null,
      album_image_url: mm.album_image_url ?? null,
    };
  });
}


// GET /api/rankings/weekly?limit=50
// 주간 랭킹 조회
router.get("/weekly", async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const sql = `
    WITH kst AS (SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst),

    -- 주간 타겟 주간 선택
    this_week AS (SELECT date_trunc('week', (SELECT now_kst FROM kst))::date AS ws),
    target_week AS (
      SELECT COALESCE(
        (SELECT ws FROM this_week tw WHERE EXISTS (
           SELECT 1 FROM ranking_weekly rw0 WHERE (rw0.week_start::date) = tw.ws
        )),
        (SELECT (rw1.week_start::date) FROM ranking_weekly rw1 ORDER BY 1 DESC LIMIT 1)
      ) AS ws
    ),

    -- 이번 주 랭킹
    cur AS (
      SELECT
        rw.rank,
        rw.music_id,
        rw.play_count,
        rw.last_played,
        (rw.week_start::date) AS week_start
      FROM ranking_weekly rw
      JOIN target_week t ON (rw.week_start::date) = t.ws
    ),

    -- 직전 주 랭킹(주간 변동 계산용)
    prev AS (
      SELECT
        rwp.music_id,
        rwp.rank AS prev_rank
      FROM ranking_weekly rwp
      JOIN target_week t ON (rwp.week_start::date) = (t.ws - INTERVAL '7 day')::date
    ),

    -- ▼▼ 일간 랭킹(오늘/어제, KST) ▼▼
    today_day      AS ( SELECT date_trunc('day', (SELECT now_kst FROM kst))::date AS ds ),
    yesterday_day  AS ( SELECT (SELECT ds FROM today_day) - INTERVAL '1 day' AS ds ),

    day_today AS (
      SELECT
        h.music_id,
        COUNT(*) AS play_count,
        MAX(h.created_at) AS last_played,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, MAX(h.created_at) DESC, h.music_id ASC) AS rank_today
      FROM history h
      JOIN today_day d ON TRUE
      WHERE h.created_at >= (d.ds::timestamptz AT TIME ZONE 'Asia/Seoul')
        AND h.created_at <  ((d.ds + INTERVAL '1 day')::timestamptz AT TIME ZONE 'Asia/Seoul')
      GROUP BY h.music_id
    ),

    day_yesterday AS (
      SELECT
        h.music_id,
        COUNT(*) AS play_count,
        MAX(h.created_at) AS last_played,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, MAX(h.created_at) DESC, h.music_id ASC) AS rank_yesterday
      FROM history h
      JOIN yesterday_day d ON TRUE
      WHERE h.created_at >= (d.ds::timestamptz AT TIME ZONE 'Asia/Seoul')
        AND h.created_at <  ((d.ds + INTERVAL '1 day')::timestamptz AT TIME ZONE 'Asia/Seoul')
      GROUP BY h.music_id
    )

    SELECT
      c.rank,
      c.music_id,
      c.play_count,
      c.last_played,

      -- 주간 변동: prev_week - curr_week
      (p.prev_rank - c.rank) AS rank_change,

      -- NEW: 오늘은 있고 어제는 없을 때만 true
      CASE
        WHEN dt.rank_today IS NOT NULL AND dy.rank_yesterday IS NULL THEN TRUE
        ELSE FALSE
      END AS day_is_new,

      -- 일간 변동:
      --  * NEW(오늘 O, 어제 X) → null (숫자 대신 NEW 배지)
      --  * 오늘 X → 0 (표시상 '-')
      --  * 그 외 → (어제 - 오늘)
      CASE
        WHEN dt.rank_today IS NOT NULL AND dy.rank_yesterday IS NULL THEN NULL
        WHEN dt.rank_today IS NULL THEN 0
        ELSE (dy.rank_yesterday - dt.rank_today)
      END AS day_rank_change
    FROM cur c
    LEFT JOIN prev p ON p.music_id = c.music_id
    LEFT JOIN day_today dt ON dt.music_id = c.music_id
    LEFT JOIN day_yesterday dy ON dy.music_id = c.music_id
    ORDER BY c.rank ASC
    LIMIT $1
  `;
  try {
    const { rows } = await pool.query(sql, [limit]);

    const metaMap = await fetchMusicMetaMap(rows.map((r) => r.music_id));
    let items = mergeRowsWithMeta(rows, metaMap).map((r) => ({
      ...r,
      day_is_new: r.day_is_new === true,
      day_rank_change: r.day_rank_change ?? null,
    }));

    // 커버 없는 항목만 Spotify로 채우기
    const needCover = items.filter((it) => !it.album_image_url);
    if (needCover.length > 0) {
      const filled = await attachCovers(needCover);
      const map = new Map(filled.map((x) => [x.music_id, x.album_image_url]));
      items = items.map((it) =>
        it.album_image_url ? it : ({ ...it, album_image_url: map.get(it.music_id) ?? null })
      );
    }

    res.json({ period: "weekly", items });
  } catch (e) {
    console.error("[rankings/weekly]", e);
    res.status(500).json({ error: "weekly_failed" });
  }
});

// GET /api/rankings/monthly?limit=50
// 월간 랭킹 조회
router.get("/monthly", async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const sql = `
    WITH kst AS (SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst),

    this_month AS (SELECT date_trunc('month', (SELECT now_kst FROM kst))::date AS ms),
    target_month AS (
      SELECT COALESCE(
        (SELECT ms FROM this_month tm WHERE EXISTS (
           SELECT 1 FROM ranking_monthly rm0 WHERE (rm0.month_start::date) = tm.ms
        )),
        (SELECT (rm1.month_start::date) FROM ranking_monthly rm1 ORDER BY 1 DESC LIMIT 1)
      ) AS ms
    ),

    cur AS (
      SELECT
        rm.rank,
        rm.music_id,
        rm.play_count,
        rm.last_played,
        (rm.month_start::date) AS month_start
      FROM ranking_monthly rm
      JOIN target_month t ON (rm.month_start::date) = t.ms
    ),

    prev AS (
      SELECT
        rmp.music_id,
        rmp.rank AS prev_rank
      FROM ranking_monthly rmp
      JOIN target_month t ON (rmp.month_start::date) = (t.ms - INTERVAL '1 month')::date
    ),

    -- ▼▼ 일간 랭킹(오늘/어제, KST) ▼▼
    today_day      AS ( SELECT date_trunc('day', (SELECT now_kst FROM kst))::date AS ds ),
    yesterday_day  AS ( SELECT (SELECT ds FROM today_day) - INTERVAL '1 day' AS ds ),

    day_today AS (
      SELECT
        h.music_id,
        COUNT(*) AS play_count,
        MAX(h.created_at) AS last_played,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, MAX(h.created_at) DESC, h.music_id ASC) AS rank_today
      FROM history h
      JOIN today_day d ON TRUE
      WHERE h.created_at >= (d.ds::timestamptz AT TIME ZONE 'Asia/Seoul')
        AND h.created_at <  ((d.ds + INTERVAL '1 day')::timestamptz AT TIME ZONE 'Asia/Seoul')
      GROUP BY h.music_id
    ),

    day_yesterday AS (
      SELECT
        h.music_id,
        COUNT(*) AS play_count,
        MAX(h.created_at) AS last_played,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, MAX(h.created_at) DESC, h.music_id ASC) AS rank_yesterday
      FROM history h
      JOIN yesterday_day d ON TRUE
      WHERE h.created_at >= (d.ds::timestamptz AT TIME ZONE 'Asia/Seoul')
        AND h.created_at <  ((d.ds + INTERVAL '1 day')::timestamptz AT TIME ZONE 'Asia/Seoul')
      GROUP BY h.music_id
    )

    SELECT
      c.rank,
      c.music_id,
      c.play_count,
      c.last_played,
      (p.prev_rank - c.rank) AS rank_change,

      -- NEW: 오늘은 있고 어제는 없을 때만 true
      CASE
        WHEN dt.rank_today IS NOT NULL AND dy.rank_yesterday IS NULL THEN TRUE
        ELSE FALSE
      END AS day_is_new,

      -- 일간 변동 규칙(weekly와 동일)
      CASE
        WHEN dt.rank_today IS NOT NULL AND dy.rank_yesterday IS NULL THEN NULL
        WHEN dt.rank_today IS NULL THEN 0
        ELSE (dy.rank_yesterday - dt.rank_today)
      END AS day_rank_change
    FROM cur c
    LEFT JOIN prev p ON p.music_id = c.music_id
    LEFT JOIN day_today dt ON dt.music_id = c.music_id
    LEFT JOIN day_yesterday dy ON dy.music_id = c.music_id
    ORDER BY c.rank ASC
    LIMIT $1
  `;
  try {
    const { rows } = await pool.query(sql, [limit]);

    const metaMap = await fetchMusicMetaMap(rows.map((r) => r.music_id));
    let items = mergeRowsWithMeta(rows, metaMap).map((r) => ({
      ...r,
      day_is_new: r.day_is_new === true,
      day_rank_change: r.day_rank_change ?? null,
    }));

    const needCover = items.filter((it) => !it.album_image_url);
    if (needCover.length > 0) {
      const filled = await attachCovers(needCover);
      const map = new Map(filled.map((x) => [x.music_id, x.album_image_url]));
      items = items.map((it) =>
        it.album_image_url ? it : ({ ...it, album_image_url: map.get(it.music_id) ?? null })
      );
    }

    res.json({ period: "monthly", items });
  } catch (e) {
    console.error("[rankings/monthly]", e);
    res.status(500).json({ error: "monthly_failed" });
  }
});

// POST /api/rankings/refresh
// 랭킹 새로고침
router.post("/refresh", async (_req, res) => {
  try {
    await pool.query("BEGIN");

    // 이번주 주간
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
               ROW_NUMBER() OVER (
                 ORDER BY a.play_count DESC, a.last_played DESC, a.music_id ASC
               ) AS rnk
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

    // 이번달 월간
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
               ROW_NUMBER() OVER (
                 ORDER BY a.play_count DESC, a.last_played DESC, a.music_id ASC
               ) AS rnk
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
