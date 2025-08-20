[1] 사용자
  └─ uploads photo (JPG/PNG)
      ↓ POST /api/photos/upload

[2] 사진 저장
  └─ DB: photos 테이블 저장 + photo_id 반환

[3] AI 서버
  └─ GET /api/photos/pending → 분석 안된 사진 목록
      ↓
     GET /api/photos/:id/binary → 바이너리 다운로드
      ↓
     이미지 분석: time + background + emotion 예측
      ↓
     POST /api/ai/results → 분석 결과 업로드
         ⇒ 백엔드에서 mood_mapping 조회
         ⇒ photo_analysis 테이블에 저장

[4] 사용자
  └─ GET /api/recommendations/by-photo/:photoId
      ↓
     DB: photo_analysis → main_mood / sub_mood
     DB: music 테이블 → 7 + 3곡 추천 반환

[5] 프론트
  └─ 음악 추천 결과 보여줌