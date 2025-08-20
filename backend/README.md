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

