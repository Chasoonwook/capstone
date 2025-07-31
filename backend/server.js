const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db'); // PostgreSQL 연결

const app = express();
app.use(cors());
app.use(express.json());

// 1. 루트 페이지 - 서버 상태 메시지
app.get('/', (req, res) => {
  res.send('Backend API Server is running');
});

// 2. 헬스체크 (서버 + DB 연결 확인)
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.send('Server & Database connection OK');
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).send('Database connection failed');
  }
});

// 3. 유저 테이블 데이터 확인 (간단 HTML로 출력)
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    if (result.rows.length === 0) {
      return res.send('<h1>No users found</h1>');
    }
    let html = '<h1>Users Table</h1><ul>';
    result.rows.forEach(user => {
      html += `<li>${user.user_id} - ${user.name} (${user.email})</li>`;
    });
    html += '</ul>';
    res.send(html);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).send('Error fetching users');
  }
});

// 라우트 연결
const userRoutes = require('./routes/users');
const photoRoutes = require('./routes/photos');
const musicRoutes = require('./routes/musics');
const recommendationRoutes = require('./routes/recommendations');

app.use('/api/users', userRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/musics', musicRoutes);
app.use('/api/recommendations', recommendationRoutes);

// 서버 실행
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));