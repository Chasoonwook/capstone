// routes/recommendations.js
// 배포 로그에서 로드 여부 확인용
console.log("[recs] router loaded v5");

const express = require("express");
const pool = require("../db");
const router = express.Router();

/* ===================== utils ===================== */
const norm = (s) => (typeof s === "string" ? s.trim() : null);
const lowTrim = (s) => (typeof s === "string" ? s.trim().toLowerCase() : s);

/** 라벨 후보: 원형 / ' 분위기' 추가·제거 / '…함'↔'…한' 변형 */
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

/** 사용자의 선호 장르 (쿼리 or 헤더) */
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

/** 사용자 id (쿼리 or 헤더: x-user-id) */
function getUserId(req) {
  const q = req.query.user_id;
  const h = req.headers["x-user-id"];
  const v = (q ?? h);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 후보 라벨(+장르)로 후보 풀 가져오기 (가중치 샘플링용) */
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
    SELECT COALESCE(music_id) AS music_id, title, artist, label, genre,
           popularity, released_at
      FROM music
     WHERE ${where}
  ORDER BY created_at DESC
     LIMIT $${idx}
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** 아무 조건 없이 후보 풀 가져오기(폴백용) */
async function fetchAnyCandidates(limit) {
  const { rows } = await pool.query(
    `SELECT COALESCE(music_id) AS music_id, title, artist, label, genre,
            popularity, released_at
       FROM music
   ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

/** 디버그용 (해당 후보로 몇 곡 있는지) */
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

/* =============== 가중치 계산 관련 =============== */
const W = { moodMain: 1.0, moodSub: 0.7, song: 1.0, pop: 0.3, recency: 0.2 };
const TAU_DAYS = 30; // 피드백 감가기반 시간 상수(일)

/** 유저 곡 피드백(지수 감가 합산) 로드: Map<music_id, score> */
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

  // 전부 0이면 무작위 보정
  if (total <= 0) {
    while (out.length < Math.min(k, pool.length)) {
      const r = Math.floor(Math.random() * pool.length);
      const itm = pool.splice(r, 1)[0];
      out.push(itm);
      used.add(itm.music_id);
    }
    return out;
  }

  // 중복 없이 k개 뽑기
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

/* ===================== 핑 ===================== */
router.get("/__ping", (_req, res) => {
  res.json({ ok: true, from: "routes/recommendations.js", version: "recs-v5" });
});

/* =============== by-photo: 5 + 2 + 3 = 10 (가중치 샘플링) =============== */
router.get("/by-photo/:photoId", async (req, res) => {
  const debug = String(req.query.debug || "") === "1";
  try {
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(photoId)) {
      return res.status(400).json({ error: "bad photoId" });
    }

    // 1) 사진의 최신 분석값
    const { rows: aRows } = await pool.query(
      `SELECT main_mood, sub_mood
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
    const preferred_genres = getPreferredGenres(req);
    const userId = getUserId(req);

    const mainCandsKey = buildLabelCandidates(main_mood);
    const subCandsKey  = buildLabelCandidates(sub_mood);

    // 2) 후보 풀 넉넉히 수집
    const [mainPool, subPool, prefPool] = await Promise.all([
      mainCandsKey.length ? fetchCandidatesByLabels({ candidates: mainCandsKey, limit: 200 }) : Promise.resolve([]),
      subCandsKey.length  ? fetchCandidatesByLabels({ candidates: subCandsKey,  limit: 200 }) : Promise.resolve([]),
      (preferred_genres.length && mainCandsKey.length)
        ? fetchCandidatesByLabels({ candidates: mainCandsKey, limit: 300, genres: preferred_genres })
        : Promise.resolve([]),
    ]);

    // 3) 유저 곡 피드백 점수(지수 감가) 로드
    const idSet = new Set([
      ...mainPool.map((x) => x.music_id),
      ...subPool.map((x) => x.music_id),
      ...prefPool.map((x) => x.music_id),
    ]);
    const allIds = Array.from(idSet);
    const songScoreMap = await loadFeedbackScores(userId, allIds);

    // 4) 가중치 샘플링 (메인5 / 서브2 / 선호3). 부족하면 ANY로 보충
    const used = new Set();

    const mainPicked = weightedSampleK(
      mainPool,
      5,
      makeScorer(songScoreMap, "main"),
      used
    );

    const subPicked = weightedSampleK(
      subPool,
      2,
      makeScorer(songScoreMap, "sub"),
      used
    );

    let prefPicked = [];
    if (preferred_genres.length) {
      prefPicked = weightedSampleK(
        prefPool.filter((x) => !used.has(x.music_id)),
        3,
        makeScorer(songScoreMap, "pref"),
        used
      );
    }

    // 선호가 부족/없으면 메인+서브 풀에서 보충 (가중치 유지)
    if (prefPicked.length < 3) {
      const remain = [...mainPool, ...subPool].filter((x) => !used.has(x.music_id));
      const extra = weightedSampleK(
        remain,
        3 - prefPicked.length,
        makeScorer(songScoreMap, "pref"),
        used
      );
      prefPicked = prefPicked.concat(extra);
    }

    // 5) 최종 페이로드
    const payload = {
      main_mood,
      sub_mood,
      preferred_genres,
      main_songs: mainPicked,
      sub_songs: subPicked,
      preferred_songs: prefPicked,
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
