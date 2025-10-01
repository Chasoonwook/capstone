### 파이프라인 

[1] 사용자
uploads photo (JPG/PNG)
↓ POST /api/photos/upload
설명 : 사진(jpg/png)을 선택하여 프론트엔드에 업로드한다. 

[2] 프론트엔드
이미지파일을 백엔드 서버의 POST /api/photos/analyze API로 전송하여 분석을 요청합니다.

[3] 백엔드
 POST /api/photos/analyze 요청
 메모리에 있는 이미지파일을 AI 서버의 POST /analyze/ API로 직접 전달하여 분석을 요청하고, AI 서버의 응답을 기다린다.

[4] AI 서버
 POST /analyze/ 요청으로 이미지 파일을 직접 받는다.
 MObileNetV2 모델 -> emotion 예측
 Yolo모델 -> background 예측
 Rule-based 시스템 -> time_label 등 예측
 분석된 결과를 JSON 혀애로 백엔드에 응답한다.

[5] 백엔드
AI 서버로부터 분석 결과 수신해
원본 이미지 파일을 Photos 테이블에 저장하고 photo_id 생성 한다
AI 분석결과를 이용해 mood_mapping 테이블을 조회하여 main_mood와 sub_mood를 결정한다.
모든 결과를 photo_analysis 테이블에 photo_id와 저장

[6] 프론트 
GET /api/recommendations/by-photo/:photoId
백엔드로 부터 추천받은 음악목록을 사용자에게



 ### API 명세 

<!-- 사진 업로드: POST /api/photos/upload

AI 서버: GET /api/photos/pending

AI 서버: GET /api/photos/:id/binary

AI 결과 업로드: POST /api/ai/results -->
====================================
대신해서 

이미지 업로드 및 AI 분석요청, DB저장 :
POST /api/photos/analyze

사용자: GET /api/recommendations/by-photo/:photoId

사용자 history : POST /api/history

사용자 피드백 : POST /api/feedback
### 설치해야 할 패키지
npm i express cors dotenv pg multer jsonwebtoken axios bcrypt
npm install cookie-parser (0918 추가)
npm install form-data(1001 추가)


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

# 사진 좋아요 싫어요에 따른 피드백 결과 (0908 추가) feedback.js 추가 / photos.js, server.js 수정
## 프론트 UI에 사용 예시 
> 피그마에서 확인

### 버튼 클릭 핸들러 >   UI에 구현된 버튼을 클릭하면 /api/feedback에 POST 요청
> 피그마에서 확인

# 점수 계산 방식
점수 = 분위기 가중치 + (곡 피드백 점수 × 가중치) + 인기(popularity) + 최신성(recency)
# DB users 테이블 spotify_dismiss_until 컬럼 추가(사용자 별로 스포티파이 연동 설정에 필요)

# Backend auth.js, feedback.js, server.js 수정(0918) 패키지 추가 설치 필요


### 결과 출력 로직 변경 (0922)
> mountain, beach 결과에 따른 출력 로직 변경
_music_ 테이블의 mood 칼럼과 _photo.analysis_ 테이블의 background를 비교한 뒤, 결과 출력
추후 배경에 따른 노래 장소 추가시 recommendation.js 의
``` const BG_SET = new Set(["mountain", "beach"]); ``` 
부분에 장소 추가 입력

```로직 : 기존의 5+2+3 방식을 고수하되, 배경 조건이 맞을 경우, sub_mood 대신 background에 맞는 노래 출력 ```

### photo.js 편집본 저장 수정 (0923)