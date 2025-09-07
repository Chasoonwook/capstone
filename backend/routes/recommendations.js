// routes/recommendations.js
// 배포 로그에서 로드 여부 확인용
console.log("[recs] router loaded v4");

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

/** 후보 라벨(+장르)로 랜덤 N곡 추출  - ANY(::text[]) 캐스팅 필수 */
async function fetchRandomByLabels({ candidates, limit, genres }) {
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
    SELECT COALESCE(music_id, id) AS music_id, title, artist, label, genre
      FROM music
     WHERE ${where}
  ORDER BY RANDOM()
     LIMIT $${idx}
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** 아무 조건 없이 랜덤 N곡(폴백용) */
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

/* ===================== 핑 ===================== */
router.get("/__ping", (_req, res) => {
  res.json({ ok: true, from: "routes/recommendations.js", version: "recs-v4" });
});

/* =============== by-photo: 5 + 2 + 3 = 10 =============== */
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

    const mainCands = buildLabelCandidates(main_mood);
    const subCands  = buildLabelCandidates(sub_mood);

    // 2) 우선 매칭으로 뽑기 (메인 5, 서브 2, 선호장르 3)
    const [mainInit, subInit, prefInit] = await Promise.all([
      mainCands.length ? fetchRandomByLabels({ candidates: mainCands, limit: 5 }) : Promise.resolve([]),
      subCands.length  ? fetchRandomByLabels({ candidates: subCands,  limit: 2 }) : Promise.resolve([]),
      mainCands.length && preferred_genres.length
        ? fetchRandomByLabels({ candidates: mainCands, limit: 3, genres: preferred_genres })
        : Promise.resolve([]),
    ]);

    // 3) 중복 제거 + 부족분은 랜덤으로 채우기
    const need = { main: 5, sub: 2, preferred: 3 };
    const seen = new Set();
    const dedup = (list) => {
      const out = [];
      list.forEach((it) => {
        const id = it.music_id ?? it.id;
        if (!seen.has(id)) { seen.add(id); out.push(it); }
      });
      return out;
    };

    let main_songs = dedup(mainInit);
    let sub_songs  = dedup(subInit);
    let preferred_songs = dedup(prefInit);

    const fill = async (arr, count) => {
      if (arr.length >= count) return arr;
      const extra = await fetchRandomAny(count - arr.length);
      extra.forEach((it) => { const id = it.music_id ?? it.id; if (!seen.has(id)) { seen.add(id); arr.push(it); }});
      return arr;
    };

    main_songs = await fill(main_songs, need.main);
    sub_songs  = await fill(sub_songs, need.sub);
    preferred_songs = await fill(preferred_songs, need.preferred);

    const payload = {
      main_mood,
      sub_mood,
      preferred_genres,
      main_songs,
      sub_songs,
      preferred_songs,
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
