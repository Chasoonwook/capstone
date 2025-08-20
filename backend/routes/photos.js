// routes/photos.js
const express = require('express');
const multer = require('multer');
const pool = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * 업로드: 바이너리를 BYTEA로 저장 + temp_name(1부터 증가)
 * form-data: photo(File)
 */
router.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // temp_name 부여
      const { rows: seqRows } = await client.query('SELECT nextval(\'photo_temp_name_seq\') AS n');
      const tempName = seqRows[0].n;

      const insertSql = `
        INSERT INTO photos (temp_name, original_name, mime_type, content)
        VALUES ($1, $2, $3, $4)
        RETURNING photo_id, temp_name, original_name, mime_type, created_at
      `;
      const vals = [tempName, req.file.originalname, req.file.mimetype, req.file.buffer];
      const { rows } = await client.query(insertSql, vals);

      await client.query('COMMIT');
      return res.json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Upload error:', e);
      return res.status(500).json({ error: 'Upload failed' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Upload outer error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/** 분석이 안 된( photo_analysis 레코드가 없는 ) 사진 목록 */
router.get('/pending', async (_req, res) => {
  try {
    const sql = `
      SELECT p.photo_id, p.temp_name, p.original_name, p.mime_type, p.created_at
      FROM photos p
      LEFT JOIN photo_analysis a ON a.photo_id = p.photo_id
      WHERE a.photo_id IS NULL
      ORDER BY p.created_at ASC
      LIMIT 50
    `;
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Pending error:', err);
    res.status(500).json({ error: 'Error fetching pending photos' });
  }
});

/** 사진 바이너리 내려주기 (AI가 가져갈 수 있도록) */
router.get('/:photoId/binary', async (req, res) => {
  try {
    const { photoId } = req.params;
    const { rows } = await pool.query(
      'SELECT mime_type, content FROM photos WHERE photo_id=$1',
      [photoId]
    );
    if (rows.length === 0) return res.status(404).send('Not found');

    res.setHeader('Content-Type', rows[0].mime_type || 'application/octet-stream');
    res.send(rows[0].content);
  } catch (err) {
    console.error('Binary error:', err);
    res.status(500).send('Error');
  }
});

module.exports = router;