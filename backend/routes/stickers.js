// routes/stickers.js
const express = require("express");
const pool = require("../db");
const multer = require("multer");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, 
  },
});

const IMAGE_MIME_WHITELIST = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

// GET /api/stickers
// 스티커 목록 반환
router.get("/stickers", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sticker_id, name
         FROM stickers
     ORDER BY created_at DESC NULLS LAST
        LIMIT 200`
    );
    return res.status(200).json(rows);
  } catch (e) {
    console.error("[stickers] list error:", e);
    return res.status(500).json({ error: "internal error" });
  }
});

// GET /api/stickers/:id/binary
// 스티커 바이너리 반환
router.get("/stickers/:id/binary", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT mime_type, content FROM stickers WHERE sticker_id = $1`,
      [id]
    );
    if (!rows.length || !rows[0].content) {
      return res.status(404).json({ error: "sticker not found" });
    }
    const { mime_type, content } = rows[0];
    res.setHeader("Content-Type", mime_type || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // 1년 캐시
    res.setHeader("ETag", `W/"s-${id}-${content.length}"`);
    return res.status(200).send(content);
  } catch (e) {
    console.error("[stickers] get binary error:", e);
    return res.status(500).json({ error: "internal error" });
  }
});

// POST /api/stickers
// 스티커 업로드
router.post("/stickers", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const name = (req.body.name || (file && file.originalname) || "").trim();

    if (!file) return res.status(400).json({ error: "file is required" });
    if (!name) return res.status(400).json({ error: "name is required" });

    const mime = file.mimetype || "application/octet-stream";
    if (!IMAGE_MIME_WHITELIST.has(mime)) {
      return res.status(400).json({ error: `unsupported mime: ${mime}` });
    }
    const buf = file.buffer;
    if (!buf || !buf.length) {
      return res.status(400).json({ error: "empty file" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO stickers (name, mime_type, content, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING sticker_id, name
      `,
      [name, mime, buf]
    );

    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error("[stickers] upload error:", e);
    return res.status(500).json({ error: "internal error" });
  }
});

module.exports = router;
