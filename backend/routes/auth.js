// Backend/routes/auth.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");

// 허용 성별
const ALLOWED_GENDERS = new Set(["남성", "여성", "기타"]);

const isEmail = (v) =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const tidy = (v) => (typeof v === "string" ? v.trim() : v ?? null);

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    let { name, gender, email, phone, password } = req.body || {};
    name = tidy(name);
    gender = tidy(gender);
    email = tidy(email);
    phone = tidy(phone);
    password = tidy(password);

    // 1) 필수값 검증
    if (!name || !gender || !email || !password) {
      return res
        .status(400)
        .json({ error: "name, gender, email, password는 필수입니다." });
    }
    if (!ALLOWED_GENDERS.has(gender)) {
      return res.status(400).json({ error: "허용되지 않는 성별입니다." });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ error: "이메일 형식이 올바르지 않습니다." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다." });
    }

    // 2) 이메일 중복 체크 (UNIQUE가 없어도 사전 차단)
    const dup = await pool.query("SELECT 1 FROM users WHERE email = $1 LIMIT 1", [email]);
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: "이미 등록된 이메일입니다." });
    }

    // 3) 비밀번호 해시
    const passwordHash = await bcrypt.hash(password, 10);

    // 4) INSERT
    const q = `
      INSERT INTO users
        (name, gender, email, phone, password, created_at, updated_at, onboarding_done, genre_setup_complete, preferred_genres)
      VALUES
        ($1,   $2,     $3,    $4,    $5,       NOW(),     NOW(),      false,            false,               '[]')
      RETURNING user_id, name, gender, email, phone, created_at
    `;
    const params = [name, gender, email, phone ?? null, passwordHash];
    const { rows } = await pool.query(q, params);


    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    console.error("[REGISTER] failed", {
      message: err.message,
      code: err.code,
      detail: err.detail,
      table: err.table,
      constraint: err.constraint,
      stack: err.stack,
    });

    if (err.code === "23505")
      return res.status(409).json({ error: "이미 등록된 이메일입니다." });
    if (err.code === "42P01")
      return res.status(500).json({ error: "테이블(users)을 찾을 수 없습니다." });
    if (err.code === "42703")
      return res.status(500).json({ error: "users 테이블 컬럼명이 일치하지 않습니다." });
    if (err.code === "23502")
      return res.status(400).json({ error: "DB NOT NULL 제약 위반 값이 있습니다." });

    return res.status(500).json({ error: "Register failed" });
  }
});

module.exports = router;
