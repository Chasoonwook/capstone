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