// routes/images.js
const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

// 사진 조회
router.get("/:photoId", async (req, res) => {
  const { photoId } = req.params;
  const { token } = req.query;

  // 토큰 존재 확인
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  // 토큰 검증 
  let payload;
  try {
    payload = jwt.verify(token, process.env.IMG_TOKEN_SECRET);
  } catch (e) {
    return res.status(401).send("Unauthorized");
  }

  // 토큰의 id 와 photoId 비교
  if (String(payload.id) !== String(photoId)) {
    return res.status(401).send("Unauthorized");
  }

  // photo_id로 사진 레코드 조회
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
