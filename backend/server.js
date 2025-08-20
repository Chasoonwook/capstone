const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db'); // PostgreSQL 연결

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // 여유

// 1. 루트
app.get('/', (req, res) => {
  res.send('Backend API Server is running');
});

// 2. 헬스체크
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.send('Server & Database connection OK');
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).send('Database connection failed');
  }
});

// 3. users 미리 있던 엔드포인트(생략)

// 4. musics 미리 있던 엔드포인트(생략)

// 라우트 연결 (기존 + 추가)
const userRoutes = require('./routes/users');
const photoRoutes = require('./routes/photos');
const musicRoutes = require('./routes/musics');
const recommendationRoutes = require('./routes/recommendations');
const aiRoutes = require('./routes/ai'); // 추가

app.use('/api/users', userRoutes);
app.use('/api/photos', photoRoutes);              // 업로드/바이너리/대기목록
app.use('/api/musics', musicRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/ai', aiRoutes);                     // AI 결과 수신

// 서버 실행
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));