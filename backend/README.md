### 파이프라인 

[1] 사용자
uploads photo (JPG/PNG)
↓ POST /api/photos/upload
설명 : 사진데이터를 데이터베이스에 저장하도록 POST요청 >> 프론트역할

[2] 사진 저장
DB: photos 테이블 저장 + photo_id 반환

[3] AI 서버
 GET /api/photos/pending 
 → 분석 안된 사진 목록 확인 >> AI역할 : 목록 검사
      ↓
GET /api/photos/:id/binary 
→ 바이너리형식으로 다운로드 >> AI역할 : AI에서 정보받기
      ↓
이미지 분석: time + background + emotion 예측 >> 기존에 제작된 AI에서 요청을 음
      ↓
POST /api/ai/results → 분석 결과를 업로드 >> results로 DB형식에 맞게 POST
    ⇒ 백엔드에서 mood_mapping 조회
    ⇒ photo_analysis 테이블에 저장

[4] 사용자
 GET /api/recommendations/by-photo/:photoId >> 프론트역할 : photo_analysis photo_id를 넣어 확인가능
  ↓
   DB: photo_analysis → main_mood / sub_mood
 DB: music 테이블 → 7 + 3곡 추천 반환

[5] 프론트
 음악 추천 결과 보여줌



 ### API 명세 

사진 업로드: POST /api/photos/upload

AI 서버: GET /api/photos/pending

AI 서버: GET /api/photos/:id/binary

AI 결과 업로드: POST /api/ai/results

사용자: GET /api/recommendations/by-photo/:photoId

사용자 history : POST /api/history
### 설치해야 할 패키지
npm i express cors dotenv pg multer jsonwebtoken axios bcrypt


### histoty.js 라우터 추가 ( 0901 )

사용자가 리스트에서 한 곡을 선택 > API 호출
반응형으로 만들어서 post 호출하면 해당 music정보와 사진정보가 같이 history에 저장되어 확인 가능

* 프론트에서 호출 예시
await fetch(`${API_BASE}/api/history`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: currentUserId,
    photo_id: currentPhotoId,
    music_id: selected.music_id,
    selected_from: selected.isMain ? 'main' : 'sub'
  })
});

misic_id 로 메타데이터 가지고 hisory테이블에 스냅샷 형식으로 저장됨.

* 조회 결과 
{
  "history_id": 15,
  "user_id": 42,
  "photo_id": 101,
  "music_id": 55,
  "title_snapshot": "Blue Bird",
  "artist_snapshot": "Ikimono Gakari",
  "genre_snapshot": "J-Pop",
  "label_snapshot": "희망적",
  "selected_from": "main",
  "created_at": "2025-09-01T23:15:30.456Z"
}