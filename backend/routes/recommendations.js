// routes/recommendations.js
const express = require("express");
const pool = require("../db");
const router = express.Router();

/** 유틸: 문자열 정리 */
function norm(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length ? t : null;
}

/** 라벨 후보: 그대로 / 끝의 " 분위기" 제거 */
function buildLabelCandidates(label) {
  const a = norm(label);
  if (!a) return [];
  const b = a.replace(/\s*분위기$/, "");
  return a === b ? [a] : [a, b];
}

/** 사용자 선호 장르 읽기
 * 우선순위: 1) query: ?genres=rock,pop  2) header: x-preferred-genres  3) DB: users.preferred_genres(text[] 또는 문자열)
 */
async function getPreferredGenres(req) {
  // 1) query
  if (typeof req.query.genres === "string") {
    return req.query.genres
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // 2) header
  if (typeof req.headers["x-preferred-genres"] === "string") {
    return String(req.headers["x-preferred-genres"])
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // 3) DB
  const userId = Number(req.query.userId || req.headers["x-user-id"]);
  if (!Number.isFinite(userId)) return [];

  try {
    // users.preferred_genres 가 text[]인 경우/문자열인 경우 둘 다 처리
    const { rows } = await pool.query(
      `SELECT preferred_genres FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (!rows.length) return [];
    const val = rows[0].preferred_genres;

    if (Array.isArray(val)) {
      return val.map((s) => String(s).trim()).filter(Boolean);
    }
    if (typeof val === "string") {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch (_) {}
  return [];
}

/** 공통 조회: 라벨 후보로 랜덤 N곡, (선택) 장르 필터 */
async function fetchRandomByLabels({ candidates, limit, genres }) {
  if (!candidates?.length || !limit) return [];
  const [L1, L2] = candidates;
  const hasSecond = Boolean(L2);
  const params = [];
  let idx = 1;

  let where = hasSecond
    ? `(label = $${idx++} OR label = $${idx++})`
    : `(label = $${idx++})`;
  params.push(L1);
  if (hasSecond) params.push(L2);

  if (Array.isArray(genres) && genres.length) {
    // 장르는 대소문자/공백을 정리해서 비교
    where += ` AND (lower(trim(genre)) = ANY($${idx++}))`;
    params.push(genres.map((g) => g.toLowerCase().trim()));
  }

  params.push(limit);
  const limitParam = `$${idx++}`;

  // music 테이블에 기본키가 music_id 라고 가정. (id라면 해당 부분을 id로 바꾸세요)
  const sql = `
    SELECT music_id, title, artist, label, genre
    FROM music
    WHERE ${where}
    ORDER BY RANDOM()
    LIMIT ${limitParam}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * 사진 ID로 추천 묶음 조회
 * - 메인 분위기: 5곡 (랜덤, 장르 무관)
 * - 서브 분위기: 2곡 (랜덤, 장르 무관)
 * - 선호 장르:   3곡 (사용자 선호 장르 ∩ 메인 분위기, 랜덤)
 *
 * 사용법(예시):
 * GET /api/recommendations/by-photo/112?userId=1
 * 또는 헤더 x-user-id 로 사용자 식별
 * 테스트 용: ?genres=rock,pop 로 선호 장르를 직접 지정할 수도 있음
 */
router.get("/by-photo/:photoId", async (req, res) => {
  try {
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(photoId)) {
      return res.status(400).json({ error: "bad photoId" });
    }

    // 1) 분석값 최신 1건
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
      return res.status(404).json({ error: "No analysis found for this photo_id" });
    }

    const main_mood = norm(aRows[0].main_mood);
    const sub_mood = norm(aRows[0].sub_mood);

    if (!main_mood && !sub_mood) {
      return res.status(409).json({ error: "Mood mapping is missing for this photo" });
    }

    // 2) 선호 장르 읽기
    const preferredGenres = await getPreferredGenres(req); // []일 수 있음

    // 3) 각 버킷 조회
    const mainCandidates = buildLabelCandidates(main_mood);
    const subCandidates = buildLabelCandidates(sub_mood);

    // 3-1) 메인 5 랜덤
    const main_songs = main_mood
      ? await fetchRandomByLabels({ candidates: mainCandidates, limit: 5 })
      : [];

    // 3-2) 서브 2 랜덤
    const sub_songs = sub_mood
      ? await fetchRandomByLabels({ candidates: subCandidates, limit: 2 })
      : [];

    // 3-3) 선호장르 3 (메인 분위기 ∩ 선호 장르, 랜덤)
    const preferred_songs =
      main_mood && preferredGenres.length
        ? await fetchRandomByLabels({
            candidates: mainCandidates,
            limit: 3,
            genres: preferredGenres,
          })
        : [];

    // 4) 응답
    return res.json({
      main_mood,
      sub_mood,
      preferred_genres: preferredGenres, // 디버깅/확인용
      main_songs,
      sub_songs,
      preferred_songs,
    });
  } catch (err) {
    console.error("Recommendation error:", err);
    return res
      .status(500)
      .json({ error: "Recommendation failed", detail: String(err?.message || err) });
  }
});

module.exports = router;
