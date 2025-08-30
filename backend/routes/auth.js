const express = require("express");
const router = express.Router();
const pool = require("../db");
// const bcrypt = require("bcrypt"); // 해싱을 원하면 주석 해제

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, password are required" });
    }

    // 이메일 중복 체크
    const dup = await pool.query("SELECT 1 FROM users WHERE email=$1 LIMIT 1", [email]);
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: "Email already exists" });
    }

    // const hash = await bcrypt.hash(password, 10);
    const hash = password; // 데모: 추후 bcrypt로 교체

    const q = `
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, name, email;
    `;
    const { rows } = await pool.query(q, [name, email, hash]);

    // 토큰 발급을 안 해도 OK (프론트에서 optional 처리함)
    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    console.error("[REGISTER] failed:", err); // ✅ 콘솔에서 스택 확인
    return res.status(500).json({ error: "Register failed" });
  }
});

module.exports = router;
