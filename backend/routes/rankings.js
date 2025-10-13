const express = require("express");
const router = express.Router();
const pool = require("../db");
const axios = require("axios");

/* ──────────────────────────────────────────────────────────────
 * 0) 공통 유틸
 * ──────────────────────────────────────────────────────────────*/
function clampLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(n, 100));
}

/* ──────────────────────────────────────────────────────────────
 * 1) Spotify 커버 (Client Credentials) + 인메모리 캐시
 * ──────────────────────────────────────────────────────────────*/
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

const coverCache = new Map(); // key: `${title}__${artist}` -> url/null
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

/* ──────────────────────────────────────────────────────────────
 * 2) music 메타 테이블/컬럼 자동 감지(캐시) + 메타 맵 조회
 * ──────────────────────────────────────────────────────────────*/
// 후보 순서: 운영 DB에 맞춰 'music'을 최우선
const META_CANDIDATES = ["music", "musics", "songs"];
let MUSIC_META_CACHE = undefined; // undefined: 미감지, null: 없음, object: 감지됨

async function detectMusicMeta() {
  const q = `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1)
  `;
  const { rows } = await pool.query(q, [META_CANDIDATES]);
  if (!rows?.length) return null;

  const byTable = new Map();
  for (const r of rows) {
    const t = r.table_name;
    if (!byTable.has(t)) byTable.set(t, new Set());
    byTable.get(t).add(r.column_name);
  }

  for (const t of META_CANDIDATES) {
    const cols = byTable.get(t);
    if (!cols) continue;

    const hasId = cols.has("music_id") || cols.has("id");
    const hasTitle = cols.has("title");
    const hasArtist = cols.has("artist");
    if (!hasId || !hasTitle || !hasArtist) continue;

    const genreCol = cols.has("genre") ? "genre" : null;
    const albumCol = cols.has("album_image_url")
      ? "album_image_url"
      : cols.has("album_image")
      ? "album_image"
      : null;

    return {
      table: t,
      idCol: cols.has("music_id") ? "music_id" : "id",
      titleCol: "title",
      artistCol: "artist",
      genreCol,
      albumCol,
    };
  }
  return null;
}

async function getMusicMetaOnce() {
  if (MUSIC_META_CACHE !== undefined) return MUSIC_META_CACHE;
  try {
    const meta = await detectMusicMeta();
    MUSIC_META_CACHE = meta || null;
  } catch (e) {
    console.warn("[rankings] detectMusicMeta failed:", e.message);
    MUSIC_META_CACHE = null;
  }
  return MUSIC_META_CACHE;
}

/** id 배열 → {id:{title,artist,genre,album_image_url}} 맵 */
async function fetchMusicMetaMap(ids) {
  const uniq = Array.from(new Set(ids)).filter((v) => Number.isFinite(Number(v)));
  if (uniq.length === 0) return new Map();

  const meta = await getMusicMetaOnce();
  if (!meta) return new Map();

  // identifier 화이트리스트 검증
  const identOk =
    /^[a-z_]+$/.test(meta.table) &&
    /^[a-z_]+$/.test(meta.idCol) &&
    /^[a-z_]+$/.test(meta.titleCol) &&
    /^[a-z_]+$/.test(meta.artistCol) &&
    (!meta.genreCol || /^[a-z_]+$/.test(meta.genreCol)) &&
    (!meta.albumCol || /^[a-z_]+$/.test(meta.albumCol));
  if (!identOk) return new Map();

  const sql = `
    SELECT
      ${meta.idCol}     AS id,
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
    rows.forEach((r) =>
      map.set(Number(r.id), {
        title: r.title ?? null,
        artist: r.artist ?? null,
        genre: r.genre ?? null,
        album_image_url: r.album_image_url ?? null,
      })
    );
    return map;
  } catch (e) {
    console.warn("[rankings] meta fetch skipped:", e.message);
    return new Map();
  }
}

function mergeRowsWithMeta(rows, metaMap) {
  return rows.map((r) => {
    const mm = metaMap.get(Number(r.music_id)) || {};
    return {
      rank: r.rank,
      music_id: r.music_id,
      play_count: r.play_count,
      last_played: r.last_played,
      music_title: mm.title ?? null,
      music_artist: mm.artist ?? null,
      music_genre: mm.genre ?? null,
      album_image_url: mm.album_image_url ?? null,
    };
  });
}

/* ──────────────────────────────────────────────────────────────
 * 3) 주간: 이번 주 없으면 최신 주차 폴백 + 타입 캐스팅(::date)
 * ──────────────────────────────────────────────────────────────*/
// GET /api/rankings/weekly?limit=50
router.get("/weekly", async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const sql = `
    WITH kst AS (SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst),
    this_week AS (SELECT date_trunc('week', (SELECT now_kst FROM kst))::date AS ws),
    target_week AS (
      SELECT COALESCE(
        (SELECT ws FROM this_week tw WHERE EXISTS (
           SELECT 1 FROM ranking_weekly rw0 WHERE (rw0.week_start::date) = tw.ws
        )),
        (SELECT (rw1.week_start::date) FROM ranking_weekly rw1 ORDER BY 1 DESC LIMIT 1)
      ) AS ws
    )
    SELECT rank, music_id, play_count, last_played
    FROM ranking_weekly rw
    JOIN target_week t ON (rw.week_start::date) = t.ws
    ORDER BY rank ASC
    LIMIT $1
  `;
  try {
    const { rows } = await pool.query(sql, [limit]);

    const metaMap = await fetchMusicMetaMap(rows.map((r) => r.music_id));
    let items = mergeRowsWithMeta(rows, metaMap);

    // 커버 없는 항목만 Spotify로 채우기
    const needCover = items.filter((it) => !it.album_image_url);
    if (needCover.length > 0) {
      const filled = await attachCovers(needCover);
      const map = new Map(filled.map((x) => [x.music_id, x.album_image_url]));
      items = items.map((it) =>
        it.album_image_url ? it : { ...it, album_image_url: map.get(it.music_id) ?? null }
      );
    }

    res.json({ period: "weekly", items });
  } catch (e) {
    console.error("[rankings/weekly]", e);
    res.status(500).json({ error: "weekly_failed" });
  }
});

/* ──────────────────────────────────────────────────────────────
 * 4) 월간: month_start ::date 비교 + 메타/커버 동일 처리
 * ──────────────────────────────────────────────────────────────*/
// GET /api/rankings/monthly?limit=50
router.get("/monthly", async (req, res) => {
  const limit = clampLimit(req.query.limit);
  const sql = `
    WITH kst AS (SELECT now() AT TIME ZONE 'Asia/Seoul' AS now_kst),
    mon AS (SELECT date_trunc('month', (SELECT now_kst FROM kst))::date AS ms)
    SELECT rank, music_id, play_count, last_played
    FROM ranking_monthly rm
    JOIN mon ON (rm.month_start::date) = ms
    ORDER BY rank ASC
    LIMIT $1
  `;
  try {
    const { rows } = await pool.query(sql, [limit]);

    const metaMap = await fetchMusicMetaMap(rows.map((r) => r.music_id));
    let items = mergeRowsWithMeta(rows, metaMap);

    const needCover = items.filter((it) => !it.album_image_url);
    if (needCover.length > 0) {
      const filled = await attachCovers(needCover);
      const map = new Map(filled.map((x) => [x.music_id, x.album_image_url]));
      items = items.map((it) =>
        it.album_image_url ? it : { ...it, album_image_url: map.get(it.music_id) ?? null }
      );
    }

    res.json({ period: "monthly", items });
  } catch (e) {
    console.error("[rankings/monthly]", e);
    res.status(500).json({ error: "monthly_failed" });
  }
});

/* ──────────────────────────────────────────────────────────────
 * 5) 집계 리프레시 (그대로 유지)
 * ──────────────────────────────────────────────────────────────*/
router.post("/refresh", async (_req, res) => {
  try {
    await pool.query("BEGIN");

    // 주간
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

    // 월간
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
