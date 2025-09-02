const express = require("express");
const router = express.Router();
const pool = require("../db");

// POST /api/music-requests  { user_id, title, artist }
router.post("/", async (req, res) => {
   const client = await pool.connect();
   try {
     const { user_id, title, artist } = req.body || {};
     if (!user_id || !title) return res.status(400).json({ error: "user_id and title are required" });

     await client.query("BEGIN");

     const { rows: k } = await client.query(
       "SELECT song_key_of($1,$2) AS song_key",
       [title, artist || null]
     );
     const song_key = k[0].song_key;

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

     const { rows: c } = await client.query(
       `SELECT request_count FROM music_requests WHERE song_key=$1`,
       [song_key]
     );

     await client.query("COMMIT");
     return res.status(201).json({
       ok: true,
       song_key,
       request_count: c[0]?.request_count ?? 1
     });
   } catch (err) {
     try { await client.query("ROLLBACK"); } catch {}
     // 🔎 에러 코드 매핑: FK/중복 등
     if (err && err.code === "23503") { // foreign_key_violation
        // users(user_id) 가 없는 경우
        return res.status(400).json({ error: "unknown_user_id" });
    }
    if (err && err.code === "23505") { // unique_violation (이론상 ON CONFLICT로 안옴)
        return res.status(409).json({ error: "already_requested" });
    }
    console.error("[music-requests POST] error:", err);
    return res.status(500).json({ error: "internal_error" });
    } finally {
        client.release();
   }
 });

 // GET /api/music-requests/count?title=...&artist=...
 router.get("/count", async (req, res) => {
   try {
     const { title, artist } = req.query;
     if (!title) return res.status(400).json({ error: "title required" });

     const { rows: k } = await pool.query(
       "SELECT song_key_of($1,$2) AS song_key",
       [title, artist || null]
     );
     const song_key = k?.[0]?.song_key;
     if (!song_key) {
        console.error("[count] song_key_of returned null:", { title, artist });
        return res.status(500).json({ error: "song_key_failed" });
     }

     const { rows } = await pool.query(
       "SELECT COALESCE(request_count,0) AS count FROM music_requests WHERE song_key=$1",
       [song_key]
     );
     return res.json({ count: rows[0]?.count ?? 0 });
   } catch (err) {
     console.error("[music-requests/count] error:", err);
     return res.status(500).json({ error: "internal_error" });
   }
 });

// (선택) 요청 취소
// DELETE /api/music-requests?user_id=1&title=...&artist=...
router.delete("/", async (req, res) => {
   const client = await pool.connect();
   try {
     const { user_id, title, artist } = req.query;
     if (!user_id || !title) return res.status(400).json({ error: "user_id and title required" });

     const { rows: k } = await client.query(
       "SELECT song_key_of($1,$2) AS song_key",
       [title, artist || null]
     );
     const song_key = k[0].song_key;

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
