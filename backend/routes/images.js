const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

/** GET /api/images/:photoId?token=...  */
router.get("/:photoId", async (req, res) => {
  try {
    const { photoId } = req.params;
    const { token } = req.query;
    if (!token) return res.status(401).send("Unauthorized");

    let payload;
    try {
      payload = jwt.verify(String(token), process.env.IMG_TOKEN_SECRET);
    } catch {
      return res.status(401).send("Unauthorized");
    }
    if (!payload || String(payload.id) !== String(photoId)) {
      return res.status(401).send("Unauthorized");
    }

    const q = `
      SELECT mime_type, content
      FROM photos
      WHERE photo_id = $1 OR id = $1
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [photoId]);
    if (!rows.length) return res.status(404).send("Not found");

    res.set("Content-Type", rows[0].mime_type || "application/octet-stream");
    res.send(rows[0].content);
  } catch (err) {
    console.error("[images] error:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;
