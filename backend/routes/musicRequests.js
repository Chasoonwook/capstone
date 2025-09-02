// routes/musicRequests.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// JS 폴백 키 생성기 (DB 함수 실패 시 사용)
function computeSongKeyJS(title, artist) {
  const t = (title || "").toLowerCase();
  const a = (artist || "").toLowerCase();
  // 악센트 제거는 생략하고 공백만 제거
  return (a + " - " + t).replace(/\s+/g, "");
}

/**
 * POST /api/music-requests
 * body: { user_id:number, title:string, artist?:string }
 */
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, title, artist } = req.body || {};
    if (!user_id || !title) {
      return res.status(400).json({ error: "user_id and title are required" });
    }

    await client.query("BEGIN");

    // 1) song_key 계산 (우선 DB 함수, 실패 시 JS 폴백)
    let song_key;
    try {
      const { rows } = await client.query(
        "SELECT song_key_of($1,$2) AS song_key",
        [title, artist || null]
      );
      song_key = rows?.[0]?.song_key;
      if (!song_key) throw new Error("song_key_of returned null");
    } catch (e) {
      console.error("[POST] song_key_of failed → fallback JS:", e?.code, e?.message);
      song_key = computeSongKeyJS(title, artist);
    }

    // 2) 유저-곡 요청 삽입 (중복이면 무시)
    const { rows } = await client.query(
      `INSERT INTO user_song_requests (user_id, song_key, title, artist)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, song_key) DO NOTHING
       RETURNING id`,
      [user_id, song_key, title, artist || null]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "already_requested" });
    }

    // 3) 최신 카운트 조회(트리거가 증가시킨 값)
    const { rows: c } = await client.query(
      "SELECT request_count FROM music_requests WHERE song_key=$1",
      [song_key]
    );

    await client.query("COMMIT");
    return res.status(201).json({
      ok: true,
      song_key,
      request_count: c?.[0]?.request_count ?? 1,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    // FK 위반(배포 DB에 해당 user_id가 없음)
    if (err?.code === "23503") {
      console.error("[POST] FK violation users(user_id):", err?.detail);
      return res.status(400).json({ error: "unknown_user_id" });
    }
    // (이론상 ON CONFLICT로 처리되지만 안전망)
    if (err?.code === "23505") {
      return res.status(409).json({ error: "already_requested" });
    }
    console.error("[music-requests POST] error:", {
      code: err?.code, msg: err?.message, detail: err?.detail, where: err?.where,
    });
    return res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/music-requests/count?title=...&artist=...
 */
router.get("/count", async (req, res) => {
  try {
    const { title, artist } = req.query;
    if (!title) return res.status(400).json({ error: "title required" });

    // song_key 계산 (DB 함수 우선, 실패 시 JS 폴백)
    let song_key;
    try {
      const { rows } = await pool.query(
        "SELECT song_key_of($1,$2) AS song_key",
        [title, artist || null]
      );
      song_key = rows?.[0]?.song_key;
      if (!song_key) throw new Error("song_key_of returned null");
    } catch (e) {
      console.error("[COUNT] song_key_of failed → fallback JS:", e?.code, e?.message);
      song_key = computeSongKeyJS(title, artist);
    }

    const { rows } = await pool.query(
      "SELECT COALESCE(request_count,0) AS count FROM music_requests WHERE song_key=$1",
      [song_key]
    );

    return res.json({ count: rows?.[0]?.count ?? 0, song_key });
  } catch (err) {
    console.error("[music-requests/count] error:", {
      code: err?.code, msg: err?.message, detail: err?.detail,
    });
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * DELETE /api/music-requests?user_id=1&title=...&artist=...
 */
router.delete("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, title, artist } = req.query;
    if (!user_id || !title) {
      return res.status(400).json({ error: "user_id and title required" });
    }

    let song_key;
    try {
      const { rows } = await client.query(
        "SELECT song_key_of($1,$2) AS song_key",
        [title, artist || null]
      );
      song_key = rows?.[0]?.song_key ?? computeSongKeyJS(title, artist);
    } catch {
      song_key = computeSongKeyJS(title, artist);
    }

    await client.query(
      "DELETE FROM user_song_requests WHERE user_id=$1 AND song_key=$2",
      [user_id, song_key]
    );

    return res.status(204).end();
  } catch (err) {
    console.error("[music-requests DELETE] error:", err);
    return res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

module.exports = router;
