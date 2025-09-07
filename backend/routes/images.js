// routes/images.js
const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

/**
 * GET /api/images/:photoId?token=...
 * - 토큰 검증(JWT id === :photoId, exp 유효)
 * - DB에서 photos.photo_id 로 조회
 * - mime_type으로 Content-Type 설정 후 content 바이너리 응답
 */
router.get("/:photoId", async (req, res) => {
  const { photoId } = req.params;
  const { token } = req.query;

  // 1) 토큰 존재
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  // 2) 토큰 검증
  let payload;
  try {
    payload = jwt.verify(token, process.env.IMG_TOKEN_SECRET);
  } catch (e) {
    return res.status(401).send("Unauthorized");
  }

  // 3) 토큰의 id === 경로 id
  if (String(payload.id) !== String(photoId)) {
    return res.status(401).send("Unauthorized");
  }

  // 4) 사진 레코드 조회 (중요: photo_id 로!)
  try {
    const { rows } = await pool.query(
      "SELECT mime_type, content FROM photos WHERE photo_id = $1 LIMIT 1",
      [photoId]
    );
    if (!rows.length) {
      return res.status(404).send("Not found");
    }

    const { mime_type, content } = rows[0];
    res.set("Content-Type", mime_type || "application/octet-stream");
    return res.send(content);
  } catch (err) {
    console.error("[images] error:", err);
    return res.status(500).send("Error");
  }
});

module.exports = router;
