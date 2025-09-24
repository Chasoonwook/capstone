// routes/stickers.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const pool = require("../db");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** 바이너리 제공: GET /api/stickers/:id/binary */
router.get("/stickers/:id/binary", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });

    const { rows } = await pool.query(
      "SELECT mime_type, content FROM stickers WHERE sticker_id=$1",
      [id]
    );
    if (!rows[0]) return res.status(404).send("Not found");

    res.set("Content-Type", rows[0].mime_type || "application/octet-stream");
    return res.send(rows[0].content);
  } catch (e) {
    console.error("[stickers/binary]", e);
    return res.status(500).json({ error: "binary failed" });
  }
});

/** 목록: GET /api/stickers  → [{sticker_id, url, name}] */
router.get("/stickers", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT sticker_id, name FROM stickers ORDER BY sticker_id DESC"
    );
    const base = `${req.protocol}://${req.get("host")}`;
    const list = rows.map((r) => ({
      sticker_id: r.sticker_id,
      name: r.name,
      url: `${base}/api/stickers/${r.sticker_id}/binary`,
    }));
    return res.json(list);
  } catch (e) {
    console.error("[stickers/list]", e);
    return res.status(500).json({ error: "list failed" });
  }
});

/** 업로드: POST /api/stickers (form-data: file) */
router.post("/stickers", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });
    const { buffer, originalname, mimetype } = req.file;

    if (!/^image\/(png|webp|jpeg)$/.test(mimetype)) {
      return res.status(400).json({ error: "image/png, image/webp, image/jpeg only" });
    }

    const { rows } = await pool.query(
      `INSERT INTO stickers (name, mime_type, content, uploader_user_id, created_at)
       VALUES ($1,$2,$3,$4, now())
       RETURNING sticker_id, name`,
      [originalname, mimetype, buffer, null]
    );

    const id = rows[0].sticker_id;
    const base = `${req.protocol}://${req.get("host")}`;
    const url = `${base}/api/stickers/${id}/binary`;

    // 편의상 url 컬럼 업데이트(선택)
    try {
      await pool.query("UPDATE stickers SET url=$1 WHERE sticker_id=$2", [url, id]);
    } catch (_) {}

    return res.json({ sticker_id: id, name: rows[0].name, url });
  } catch (e) {
    console.error("[stickers/upload]", e);
    return res.status(500).json({ error: "upload failed" });
  }
});

module.exports = router;
