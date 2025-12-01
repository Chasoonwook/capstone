// routes/recommendations.js
// 배포 로그에서 로드 여부 확인용
console.log("[recs] router loaded v6+enrich+normalize");

const express = require("express");
const axios = require("axios");
const pool = require("../db");
const router = express.Router();

// 문자열 정규화 함수
const norm = (s) => (typeof s === "string" ? s.trim() : null);
const lowTrim = (s) => (typeof s === "string" ? s.trim().toLowerCase() : s);

// 라벨 후보군 빌더
function buildLabelCandidates(label) {
  const s = typeof label === "string" ? label.trim() : "";
  if (!s) return [];
  const base = s.replace(/\s*분위기$/, "");
  const alt =
    base.endsWith("함") ? base.replace(/함$/, "한")
  : base.endsWith("한") ? base.replace(/한$/, "함")
  : null;

  const set = new Set([base, `${base} 분위기`, ...(alt ? [alt, `${alt} 분위기`] : [])]);
  return Array.from(set).map((x) => x.toLowerCase());
}

// 선호 장르 
function getPreferredGenres(req) {
  if (typeof req.query.genres === "string") {
    return req.query.genres.split(",").map((x) => x.trim()).filter(Boolean);
  }
  if (typeof req.headers["x-preferred-genres"] === "string") {
    return String(req.headers["x-preferred-genres"])
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

// 사용자 ID 추출
function getUserId(req) {
  const q = req.query.user_id;
  const h = req.headers["x-user-id"];
  const v = (q ?? h);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 라벨 및 장르로 후보곡 조회
async function fetchCandidatesByLabels({ candidates, limit, genres }) {
  if (!candidates?.length || !limit) return [];
  const params = [];
  let idx = 1;

  let where = `lower(trim(label)) = ANY($${idx++}::text[])`;
  params.push(candidates.map(lowTrim));

  if (Array.isArray(genres) && genres.length) {
    where += ` AND lower(trim(genre)) = ANY($${idx++}::text[])`;
    params.push(genres.map(lowTrim));
  }

  params.push(limit);
  const sql = `
    SELECT COALESCE(music_id) AS music_id,
           title, artist, label, genre,
           popularity, released_at, mood,
           NULLIF(url, 'EMPTY') AS preview_url,  -- 'EMPTY' → NULL 정규화
           NULL::text AS album_image,
           NULL::text AS spotify_track_id
      FROM music
     WHERE ${where}
  ORDER BY created_at DESC
     LIMIT $${idx}
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function fetchCandidatesByMood({ mood, limit }) {
  if (!mood || !limit) return [];
  const sql = `
    SELECT COALESCE(music_id) AS music_id,
           title, artist, label, genre,
           popularity, released_at, mood,
           NULLIF(url, 'EMPTY') AS preview_url,
           NULL::text AS album_image,
           NULL::text AS spotify_track_id
      FROM music
     WHERE lower(trim(mood)) = lower($1)
  ORDER BY created_at DESC
     LIMIT $2
  `;
  const { rows } = await pool.query(sql, [mood, limit]);
  return rows;
}

async function fetchAnyCandidates(limit) {
  const { rows } = await pool.query(
    `SELECT COALESCE(music_id) AS music_id,
            title, artist, label, genre,
            popularity, released_at, mood,
            NULLIF(url, 'EMPTY') AS preview_url,
            NULL::text AS album_image,
            NULL::text AS spotify_track_id
       FROM music
   ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function countByLabels({ candidates, genres }) {
  const out = { by_label: [], total: 0 };
  if (!candidates?.length) return out;

  const params = [];
  let idx = 1;
  let where = `lower(trim(label)) = ANY($${idx++}::text[])`;
  params.push(candidates.map(lowTrim));

  if (Array.isArray(genres) && genres.length) {
    where += ` AND lower(trim(genre)) = ANY($${idx++}::text[])`;
    params.push(genres.map(lowTrim));
  }

  const sql = `
    SELECT label, COUNT(*)::int AS c
      FROM music
     WHERE ${where}
  GROUP BY label
  ORDER BY c DESC
  `;
  const { rows } = await pool.query(sql, params);
  out.by_label = rows;
  out.total = rows.reduce((s, r) => s + Number(r.c || 0), 0);
  return out;
}

// 가중치 계산
const W = { moodMain: 1.0, moodSub: 0.7, song: 1.0, pop: 0.3, recency: 0.2 };
const TAU_DAYS = 30;

async function loadFeedbackScores(userId, musicIds) {
  if (!userId || !musicIds?.length) return new Map();
  const { rows } = await pool.query(
    `SELECT music_id,
            SUM(feedback * EXP(-GREATEST(EXTRACT(EPOCH FROM (NOW() - created_at))/86400.0,0)/$1)) AS s
       FROM user_song_feedback
      WHERE user_id = $2
        AND music_id = ANY($3)
      GROUP BY music_id`,
    [TAU_DAYS, userId, musicIds]
  );
  return new Map(rows.map((r) => [Number(r.music_id), Number(r.s)]));
}

function computeRecency(released_at, now) {
  if (!released_at) return 0;
  const t = new Date(released_at).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (now - t) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(days, 0));
}

function makeScorer(songScoreMap, bucket) {
  const now = Date.now();
  const mood = bucket === "main" ? W.moodMain : bucket === "sub" ? W.moodSub : 0;
  return (item) => {
    const id  = Number(item.music_id);
    const sfb = songScoreMap.get(id) || 0;
    const pop = Number(item.popularity ?? 0);
    const rec = computeRecency(item.released_at, now);
    const s = mood + W.song * sfb + W.pop * pop + W.recency * rec;
    return Math.max(s, 0);
  };
}

function weightedSampleK(arr, k, weightFn, used) {
  const out = [];
  const pool = arr.filter((x) => !used.has(x.music_id));
  if (!pool.length || k <= 0) return out;

  const weights = pool.map((x) => weightFn(x));
  let total = weights.reduce((a, b) => a + b, 0);

  if (total <= 0) {
    while (out.length < Math.min(k, pool.length)) {
      const r = Math.floor(Math.random() * pool.length);
      const itm = pool.splice(r, 1)[0];
      out.push(itm);
      used.add(itm.music_id);
    }
    return out;
  }

  while (out.length < k && pool.length > 0 && total > 0) {
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      if (r < weights[idx]) break;
      r -= weights[idx];
    }
    if (idx >= pool.length) idx = pool.length - 1;
    const itm = pool.splice(idx, 1)[0];
    const w = weights.splice(idx, 1)[0];
    total -= w;
    out.push(itm);
    used.add(itm.music_id);
  }
  return out;
}

function randomSampleK(arr, k, used) {
  const out = [];
  const pool = arr.filter((x) => !used.has(x.music_id));
  if (!pool.length || k <= 0) return out;
  while (out.length < Math.min(k, pool.length)) {
    const r = Math.floor(Math.random() * pool.length);
    const itm = pool.splice(r, 1)[0];
    out.push(itm);
    used.add(itm.music_id);
  }
  return out;
}

// 스포티파이 보강
async function enrichWithSpotify(req, list) {
  if (!Array.isArray(list) || list.length === 0) return list;

  // 사용자 쿠키가 없으면 보강 시도를 생략
  const ck = req.headers.cookie || "";
  if (!/sp_access=|sp_refresh=/.test(ck)) return list;

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  async function fillOne(item) {
     
    const hasPreview = item.preview_url && item.preview_url !== "EMPTY";
    if (item.spotify_track_id && item.album_image && hasPreview) return item;

    const q = [item.title, item.artist].filter(Boolean).join(" ");
    if (!q) return item;

    try {
      const r = await axios.get(`${baseUrl}/api/spotify/search`, {
        params: { q, type: "track", limit: 1 },
        headers: { cookie: ck },
        timeout: 8000,
      });

      const track = r.data?.tracks?.items?.[0];
      if (!track) return item;

      const albumImg = track.album?.images?.[0]?.url || null;
      const preview  = track.preview_url || null;
      const trackId  = track.id || null;

      return {
        ...item,
        album_image: item.album_image || albumImg,
        preview_url: hasPreview ? item.preview_url : (preview || null),
        spotify_track_id: item.spotify_track_id || trackId,
      };
    } catch {
      return item;
    }
  }

  // 병렬 보강
  return await Promise.all(list.map(fillOne));
}

// 헬스체크
router.get("/__ping", (_req, res) => {
  res.json({ ok: true, from: "routes/recommendations.js", version: "recs-v6+enrich+normalize" });
});

// GET /api/recommendations/by-photo/:photoId?debug
// 사진 기반 추천곡 조회
router.get("/by-photo/:photoId", async (req, res) => {
  const debug = String(req.query.debug || "") === "1";
  try {
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(photoId)) {
      return res.status(400).json({ error: "bad photoId" });
    }

    // 사진의 최신 분석 결과 조회
    const { rows: aRows } = await pool.query(
      `SELECT main_mood, sub_mood, background
         FROM photo_analysis
        WHERE photo_id = $1
     ORDER BY analyzed_at DESC
        LIMIT 1`,
      [photoId]
    );

    if (!aRows.length) {
      return res.json({
        main_mood: null,
        sub_mood: null,
        preferred_genres: [],
        main_songs: [],
        sub_songs: [],
        preferred_songs: [],
        ...(debug && { debug: { reason: "no photo_analysis row" } }),
      });
    }

    const main_mood = norm(aRows[0].main_mood);
    const sub_mood  = norm(aRows[0].sub_mood);
    const background = lowTrim(aRows[0].background); 
    const preferred_genres = getPreferredGenres(req);
    const userId = getUserId(req);

    const mainCandsKey = buildLabelCandidates(main_mood);
    const subCandsKey  = buildLabelCandidates(sub_mood);

    // 후보 풀 수집
    const [mainPool, subPool, prefPool] = await Promise.all([
      mainCandsKey.length ? fetchCandidatesByLabels({ candidates: mainCandsKey, limit: 200 }) : Promise.resolve([]),
      subCandsKey.length  ? fetchCandidatesByLabels({ candidates: subCandsKey,  limit: 200 }) : Promise.resolve([]),
      (preferred_genres.length && mainCandsKey.length)
        ? fetchCandidatesByLabels({ candidates: mainCandsKey, limit: 300, genres: preferred_genres })
        : Promise.resolve([]),
    ]);

    // 유저 곡 피드백 점수 로드
    const idSet = new Set([
      ...mainPool.map((x) => x.music_id),
      ...subPool.map((x) => x.music_id),
      ...prefPool.map((x) => x.music_id),
    ]);
    const allIds = Array.from(idSet);
    const songScoreMap = await loadFeedbackScores(userId, allIds);

    // 곡 샘플링
    const used = new Set();

    const mainPicked = weightedSampleK(mainPool, 5, makeScorer(songScoreMap, "main"), used);

    const BG_SET = new Set(["mountain", "beach"]);
    let subPicked = [];

    if (background && BG_SET.has(background)) {
      const bgPool = await fetchCandidatesByMood({ mood: background, limit: 200 });
      subPicked = randomSampleK(bgPool, 2, used);
      if (subPicked.length < 2) {
        const anyPool = await fetchAnyCandidates(100);
        const extra = randomSampleK(anyPool, 2 - subPicked.length, used);
        subPicked = subPicked.concat(extra);
      }
    } else {
      subPicked = weightedSampleK(subPool, 2, makeScorer(songScoreMap, "sub"), used);
      if (subPicked.length < 2) {
        const anyPool = await fetchAnyCandidates(100);
        const extra = randomSampleK(anyPool, 2 - subPicked.length, used);
        subPicked = subPicked.concat(extra);
      }
    }

    let prefPicked = [];
    if (preferred_genres.length) {
      prefPicked = weightedSampleK(
        prefPool.filter((x) => !used.has(x.music_id)),
        3,
        makeScorer(songScoreMap, "pref"),
        used
      );
    }
    if (prefPicked.length < 3) {
      const remain = [...mainPool, ...subPool].filter((x) => !used.has(x.music_id));
      const extra = weightedSampleK(remain, 3 - prefPicked.length, makeScorer(songScoreMap, "pref"), used);
      prefPicked = prefPicked.concat(extra);
    }

    // 최종 페이로드 구성
    const payload = {
      main_mood,
      sub_mood,
      background,
      preferred_genres,
      main_songs: await enrichWithSpotify(req, mainPicked),
      sub_songs: await enrichWithSpotify(req, subPicked),
      preferred_songs: await enrichWithSpotify(req, prefPicked),
    };

    if (debug) {
      const [mCnt, sCnt, pCnt] = await Promise.all([
        countByLabels({ candidates: mainCandsKey }),
        countByLabels({ candidates: subCandsKey }),
        countByLabels({ candidates: mainCandsKey, genres: preferred_genres }),
      ]);
      payload.debug = {
        main_candidates: mainCandsKey,
        sub_candidates: subCandsKey,
        background_matched: Boolean(background && BG_SET.has(background)),
        counts: { main: mCnt, sub: sCnt, preferred: pCnt },
        selected_counts: {
          main: payload.main_songs.length,
          sub: payload.sub_songs.length,
          preferred: payload.preferred_songs.length,
        },
      };
    }

    return res.json(payload);
  } catch (err) {
    console.error("Recommendation error:", err);
    res.status(500).json({ error: "Recommendation failed", detail: String(err?.message || err) });
  }
});

module.exports = router;
