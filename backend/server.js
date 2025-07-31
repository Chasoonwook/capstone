const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 라우트 불러오기
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


//요청 테스트
app.get('/test-users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    // 간단한 HTML로 출력
    let html = '<h1>Users Table</h1><ul>';
    result.rows.forEach(user => {
      html += `<li>${user.user_id} - ${user.name} (${user.email})</li>`;
    });
    html += '</ul>';
    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});