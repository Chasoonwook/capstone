// routes/recommendations.js
const express = require("express");
const pool = require("../db");
const router = express.Router();

/* ---------- 유틸 ---------- */
const norm = (s) => (typeof s === "string" ? s.trim() : null);
const lowTrim = (s) => (typeof s === "string" ? s.trim().toLowerCase() : s);

// 라벨 후보: 원형 / ' 분위기' 제거/추가 / '…함' ↔ '…한' 양쪽 생성
function buildLabelCandidates(label) {
  const s = typeof label === "string" ? label.trim() : "";
  if (!s) return [];

  // 접미사 ' 분위기' 제거
  const base = s.replace(/\s*분위기$/, "");

  // '함' ↔ '한' 변형
  const alt =
    base.endsWith("함") ? base.replace(/함$/, "한")
  : base.endsWith("한") ? base.replace(/한$/, "함")
  : null;

  const cand = new Set([
    base,                   // e.g., '희망적', '따뜻함'
    `${base} 분위기`,       // e.g., '희망적 분위기', '따뜻함 분위기'
  ]);
  if (alt) {
    cand.add(alt);          // '따뜻한'
    cand.add(`${alt} 분위기`); // '따뜻한 분위기'
  }
  return Array.from(cand);
}


/** 선호 장르 가져오기 (쿼리 → 헤더 → (원하면 DB로 확장)) */
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
  // 필요하면 여기서 users.preferred_genres 조회 추가
  return [];
}

/** 후보 라벨(+선택 장르)로 랜덤 N곡 */
async function fetchRandomByLabels({ candidates, limit, genres }) {
  if (!candidates?.length || !limit) return [];
  const normCands = candidates.map(lowTrim);

  const params = [normCands];
  let idx = 2;

  let where = `lower(trim(label)) = ANY($1)`;

  if (Array.isArray(genres) && genres.length) {
    where += ` AND lower(trim(genre)) = ANY($${idx++})`;
    params.push(genres.map(lowTrim));
  }

  params.push(limit);
  const lim = `$${idx++}`;

  const sql = `
    SELECT music_id, title, artist, label, genre
    FROM music
    WHERE ${where}
    ORDER BY RANDOM()
    LIMIT ${lim}
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** 디버그용 카운트 */
async function countByLabels({ candidates, genres }) {
  const out = { by_label: [], total: 0 };
  if (!candidates?.length) return out;
  const normCands = candidates.map(lowTrim);

  const params = [normCands];
  let idx = 2;
  let where = `lower(trim(label)) = ANY($1)`;
  if (Array.isArray(genres) && genres.length) {
    where += ` AND lower(trim(genre)) = ANY($${idx++})`;
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

/** 사진ID 기반 추천 10곡 생성: 메인5 + 서브2 + 선호장르3 */
router.get("/by-photo/:photoId", async (req, res) => {
  const debug = String(req.query.debug || "") === "1";
  try {
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(photoId)) {
      return res.status(400).json({ error: "bad photoId" });
    }

    // 1) 최신 분석값
    const { rows: aRows } = await pool.query(
      `
      SELECT main_mood, sub_mood
      FROM photo_analysis
      WHERE photo_id = $1
      ORDER BY analyzed_at DESC
      LIMIT 1
      `,
      [photoId]
    );
    if (!aRows.length) {
      return res.status(200).json({
        main_mood: null,
        sub_mood: null,
        main_songs: [],
        sub_songs: [],
        preferred_songs: [],
        ...(debug && { debug: { reason: "no photo_analysis row" } }),
      });
    }

    const main_mood = norm(aRows[0].main_mood);
    const sub_mood  = norm(aRows[0].sub_mood);

    const preferred_genres = await getPreferredGenres(req);

    const mainCands = buildLabelCandidates(main_mood);
    const subCands  = buildLabelCandidates(sub_mood);

    // 2) 추천 뽑기
    const [main_songs, sub_songs, preferred_songs] = await Promise.all([
      mainCands.length ? fetchRandomByLabels({ candidates: mainCands, limit: 5 }) : Promise.resolve([]),
      subCands.length  ? fetchRandomByLabels({ candidates: subCands,  limit: 2 }) : Promise.resolve([]),
      mainCands.length && preferred_genres.length
        ? fetchRandomByLabels({ candidates: mainCands, limit: 3, genres: preferred_genres })
        : Promise.resolve([]),
    ]);

    // 3) 디버그 정보(선택)
    let dbg = undefined;
    if (debug) {
      const [mCnt, sCnt, pCnt] = await Promise.all([
        countByLabels({ candidates: mainCands }),
        countByLabels({ candidates: subCands }),
        countByLabels({ candidates: mainCands, genres: preferred_genres }),
      ]);
      dbg = {
        main_candidates: mainCands,
        sub_candidates: subCands,
        preferred_genres,
        counts: { main: mCnt, sub: sCnt, preferred: pCnt },
        selected_counts: {
          main: main_songs.length,
          sub: sub_songs.length,
          preferred: preferred_songs.length,
        },
      };
    }

    return res.json({
      main_mood,
      sub_mood,
      preferred_genres,
      main_songs,
      sub_songs,
      preferred_songs,
      ...(dbg ? { debug: dbg } : {}),
    });
  } catch (err) {
    console.error("Recommendation error:", err);
    res.status(500).json({ error: "Recommendation failed", detail: String(err?.message || err) });
  }
});

module.exports = router;
