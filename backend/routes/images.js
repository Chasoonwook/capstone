const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

// GET /api/images/:id?token=...
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  if (!token) return res.sendStatus(400);

  try {
    const payload = jwt.verify(token, process.env.IMG_TOKEN_SECRET);

    // 숫자/문자 타입 차이 방지
    if (String(payload.id) !== String(id)) return res.sendStatus(403);

    // 실제 스키마: photo_id, mime_type, content
    const { rows } = await pool.query(
      "SELECT content, mime_type FROM photos WHERE photo_id = $1",
      [id]
    );
    if (!rows[0]) return res.sendStatus(404);

    res.set("Content-Type", rows[0].mime_type);
    // 대용량이면 스트리밍으로 교체 가능
    return res.send(rows[0].content);
  } catch (e) {
    return res.sendStatus(401); // 토큰 만료/위조
  }
});

module.exports = router;
