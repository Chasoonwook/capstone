// routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

/* =========================
 * JWT / Cookie 설정
 * ========================= */
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRES_IN = "7d";
const COOKIE_NAME = "app_token";
const isProd = process.env.NODE_ENV === "production";

/* =========================
 * 유틸
 * ========================= */
const trim = (s) => (s ?? "").toString().trim();
const toKoreanGender = (g) => {
  if (!g) return null;
  const t = String(g).trim().toLowerCase();
  if (["m", "male", "남", "남성"].includes(t)) return "남성";
  if (["f", "female", "여", "여성"].includes(t)) return "여성";
  return null;
};
const digitsOnly = (s) => (s ? String(s).replace(/\D/g, "") : null);

/** JWT 발급 + httpOnly 쿠키 심기
 *  - 프론트/백 분리 배포를 고려해 sameSite/secure 조정
 */
function issueTokenAndSetCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,            // 프로덕션에서만 secure
    sameSite: isProd ? "none" : "lax", // 교차 사이트 쿠키 허용
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,   // 7일
  });
  return token;
}

/** 요청에서 토큰 추출 (쿠키 우선 → Authorization: Bearer ...) */
function pickToken(req) {
  const c = req.cookies?.[COOKIE_NAME];
  if (c) return c;
  const h = req.headers.authorization || req.headers.Authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "");
  return null;
}

/** 인증 미들웨어
 *  - 성공 시 req.auth = { sub, email, iat, exp }
 */
async function authRequired(req, res, next) {
  try {
    const token = pickToken(req);
    if (!token) return res.status(401).json({ error: "missing token" });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.auth = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "invalid token" });
  }
}

/* =========================
 * 라우트
 * ========================= */

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const name = trim(req.body?.name);
    const email = trim(req.body?.email);
    const password = req.body?.password || "";
    const gender = toKoreanGender(req.body?.gender);
    const phone = digitsOnly(req.body?.phone);

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, password are required" });
    }

    const { rows: dup } = await pool.query(
      "SELECT 1 FROM users WHERE lower(email)=lower($1) LIMIT 1",
      [email]
    );
    if (dup.length) return res.status(409).json({ error: "Email already exists" });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, gender, phone, genre_setup_complete)
       VALUES ($1,$2,$3,$4,$5,false)
       RETURNING user_id AS id, name, email, COALESCE(genre_setup_complete,false) AS genre_setup_complete`,
      [name, email, hash, gender, phone]
    );
    const user = rows[0];

    const token = issueTokenAndSetCookie(res, { sub: user.id, email: user.email });

    res.status(201).json({
      token, // 참고용
      user: { id: user.id, name: user.name, email: user.email },
      onboarding_done: false,
      genre_setup_complete: user.genre_setup_complete,
    });
  } catch (err) {
    console.error("[REGISTER ERROR]", err);
    if (err.code === "23505") return res.status(409).json({ error: "Email already exists" });
    if (err.code && err.code.startsWith("23"))
      return res.status(400).json({ error: "Invalid data for insert" });
    return res.status(500).json({ error: "Register failed" });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const email = trim(req.body?.email);
    const password = req.body?.password || "";
    if (!email || !password) return res.status(400).json({ error: "email, password required" });

    const { rows } = await pool.query(
      `SELECT user_id AS id, name, email, password_hash,
              COALESCE(genre_setup_complete,false) AS genre_setup_complete,
              COALESCE(onboarding_done,false)        AS onboarding_done
         FROM users
        WHERE lower(email)=lower($1)
        LIMIT 1`,
      [email]
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "invalid password" });

    const token = issueTokenAndSetCookie(res, { sub: u.id, email: u.email });

    res.json({
      token, // 참고용
      user: { id: u.id, name: u.name, email: u.email },
      onboarding_done: u.onboarding_done,
      genre_setup_complete: u.genre_setup_complete,
    });
  } catch (err) {
    console.error("[LOGIN ERROR]", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

// LOGOUT
router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });
  res.json({ ok: true });
});

// ME
router.get("/me", authRequired, async (req, res) => {
  try {
    const userId = Number(req.auth?.sub);
    if (!userId) return res.status(401).json({ error: "invalid token payload" });

    const { rows } = await pool.query(
      `SELECT user_id AS id, name, email,
              COALESCE(genre_setup_complete,false) AS genre_setup_complete,
              COALESCE(onboarding_done,false)        AS onboarding_done
         FROM users
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });

    const u = rows[0];
    res.json({
      id: u.id,
      name: u.name,
      email: u.email,
      onboarding_done: u.onboarding_done,
      genre_setup_complete: u.genre_setup_complete,
    });
  } catch (e) {
    console.error("[ME ERROR]", e);
    res.status(500).json({ error: "me failed" });
  }
});

/* =========================
 * export
 *  - router 기본 내보내기 + 미들웨어도 함께 노출
 * ========================= */
router.authRequired = authRequired;        // 함수 속성으로 추가
module.exports = router;                   // 다른 라우터에서 require("./auth").authRequired 로 접근 가능
