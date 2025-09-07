// routes/recommendations.js
const express = require("express");
const pool = require("../db");
const router = express.Router();

/* ---------- utils ---------- */
const norm = (s) => (typeof s === "string" ? s.trim() : null);
const lowTrim = (s) => (typeof s === "string" ? s.trim().toLowerCase() : s);

// 라벨 후보: 원형 / ' 분위기' 추가·제거 / '…함'↔'…한' 변형
function buildLabelCandidates(label) {
  const s = typeof label === "string" ? label.trim() : "";
  if (!s) return [];
  const base = s.replace(/\s*분위기$/, "");
  const alt =
    base.endsWith("함") ? base.replace(/함$/, "한")
  : base.endsWith("한") ? base.replace(/한$/, "함")
  : null;

  const set = new Set([base, `${base} 분위기`, ...(alt ? [alt, `${alt} 분위기`] : [])]);
  return Array.from(set);
}

// 선호 장르(쿼리→헤더)
async function getPreferredGenres(req) {
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

// 후보 라벨(+선호장르)로 랜덤 N곡  ✅ ANY($n::text[]) 캐스팅 + id/music_id 호환
async function fetchRandomByLabels({ candidates, limit, genres }) {
  if (!candidates?.length || !limit) return [];
  const normCands = candidates.map(lowTrim);

  const params = [];
  let idx = 1;

  let where = `lower(trim(label)) = ANY($${idx++}::text[])`;     // ⚠️ 반드시 ::text[]
  params.push(normCands);

  if (Array.isArray(genres) && genres.length) {
    where += ` AND lower(trim(genre)) = ANY($${idx++}::text[])`; // ⚠️ 반드시 ::text[]
    params.push(genres.map(lowTrim));
  }

  params.push(limit);
  const lim = `$${idx++}`;

  const sql = `
    SELECT COALESCE(music_id, id) AS music_id, title, artist, label, genre
    FROM music
    WHERE ${where}
    ORDER BY RANDOM()
    LIMIT ${lim}
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

// 아무 조건 없이 랜덤 N곡 (폴백용)
async function fetchRandomAny(limit) {
  const { rows } = await pool.query(
    `SELECT COALESCE(music_id, id) AS music_id, title, artist, label, genre
     FROM music
     ORDER BY RANDOM()
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// 디버그용 카운트
async function countByLabels({ candidates, genres }) {
  const out = { by_label: [], total: 0 };
  if (!candidates?.length) return out;
  const normCands = candidates.map(lowTrim);

  const params = [];
  let idx = 1;

  let where = `lower(trim(label)) = ANY($${idx++}::text[])`;
  params.push(normCands);

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

/* ---------- 핑: 새 코드가 배포됐는지 확인용 ---------- */
router.get("/__ping", (_req, res) => {
  res.json({ ok: true, from: "routes/recommendations.js", version: "recs-v3", now: new Date().toISOString() });
});

/* ---------- 메인 라우트 ---------- */
// 사진ID 기반 추천 10곡: 메인5 + 서브2 + (선호장르)3, 모자라면 전체 랜덤으로 보충
router.get("/by-photo/:photoId", async (req, res) => {
  const debug = String(req.query.debug || "") === "1";
  try {
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(photoId)) return res.status(400).json({ error: "bad photoId" });

    // 1) 최신 분석값
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
        main_mood: null, sub_mood: null,
        main_songs: [], sub_songs: [], preferred_songs: [],
        ...(debug && { debug: { reason: "no photo_analysis row" } }),
      });
    }

    const main_mood = norm(aRows[0].main_mood);
    const sub_mood  = norm(aRows[0].sub_mood);
    const preferred_genres = await getPreferredGenres(req);

    const mainCands = buildLabelCandidates(main_mood);
    const subCands  = buildLabelCandidates(sub_mood);

    // 2) 우선 매칭으로 뽑기
    let [main_songs, sub_songs, preferred_songs] = await Promise.all([
      mainCands.length ? fetchRandomByLabels({ candidates: mainCands, limit: 5 }) : Promise.resolve([]),
      subCands.length  ? fetchRandomByLabels({ candidates: subCands,  limit: 2 }) : Promise.resolve([]),
      mainCands.length && preferred_genres.length
        ? fetchRandomByLabels({ candidates: mainCands, limit: 3, genres: preferred_genres })
        : Promise.resolve([]),
    ]);

    // 3) 모자라면 전체 랜덤으로 채움 + 중복 제거
    const need = { main: 5, sub: 2, preferred: 3 };
    const seen = new Set();
    const dedupPush = (arr, item) => {
      const id = item.music_id ?? item.id;
      if (seen.has(id)) return false;
      seen.add(id); arr.push(item); return true;
    };
    [main_songs, sub_songs, preferred_songs] = [main_songs, sub_songs, preferred_songs].map((lst) => {
      const out = []; lst.forEach((it) => dedupPush(out, it)); return out;
    });
    const fill = async (arr, count) => {
      if (arr.length >= count) return arr;
      const extra = await fetchRandomAny(count - arr.length);
      extra.forEach((it) => dedupPush(arr, it));
      return arr;
    };
    main_songs = await fill(main_songs, need.main);
    sub_songs = await fill(sub_songs, need.sub);
    preferred_songs = await fill(preferred_songs, need.preferred);

    const payload = {
      main_mood, sub_mood, preferred_genres,
      main_songs, sub_songs, preferred_songs,
    };

    if (debug) {
      const [mCnt, sCnt, pCnt] = await Promise.all([
        countByLabels({ candidates: mainCands }),
        countByLabels({ candidates: subCands }),
        countByLabels({ candidates: mainCands, genres: preferred_genres }),
      ]);
      payload.debug = {
        main_candidates: mainCands,
        sub_candidates: subCands,
        counts: { main: mCnt, sub: sCnt, preferred: pCnt },
        selected_counts: {
          main: main_songs.length,
          sub: sub_songs.length,
          preferred: preferred_songs.length,
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
