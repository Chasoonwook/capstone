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

### diaries.js 기능 추가 (1002)

### users.js 코드 수정 (1008)
/me 엔드포인트 추가 해서 항상 DB에서 preferred_genres 읽어 오도록 수정

### ranking.js 코드 수정 (1008)
* 호출 URL: ( limit 뒤에있는 숫자 변경하면 랭킹 개수 반환)
주간: /api/rankings/weekly?limit=50
월간: /api/rankings/monthly?limit=50 

* 랭킹 리프레시 (자동)
POST /api/rankings/refresh
해당 핸들러로 주간,월간 집계를 재계산 가능or SQL 집계 최신화를 통해 최신화가능

### ranking.js 코드 수정 (1013)
1) 엔드포인트/리밋 처리

(기존) 경로 프리픽스가 rankings-simple로 사용되기도 함.

(최종) 프론트 표준 경로에 맞춰 GET /api/rankings/weekly, GET /api/rankings/monthly 로 고정.
리밋 처리도 유틸 clampLimit()로 통일해 1~100 범위 보정.

2) 주간 쿼리의 “이번 주 미집계” 폴백 로직 추가

(기존) 항상 “이번 주”만 딱 조회 → 해당 주차 레코드가 없으면 빈 결과.

(최종) 이번 주가 비어 있으면 가장 최근 주차로 자동 폴백.

-- 핵심 아이디어 (요약)
WITH this_week AS (...),
     target_week AS (
       SELECT COALESCE(
         -- 이번 주 데이터가 있으면 이번 주
         (SELECT tw.week_start_kst FROM this_week tw WHERE EXISTS (... ranking_weekly ...)),
         -- 없으면 가장 최근 주차
         (SELECT (rw.week_start::date) FROM ranking_weekly rw ORDER BY 1 DESC LIMIT 1)
       ) AS week_start_kst
     )
SELECT ...
FROM ranking_weekly rw
JOIN target_week tw ON (rw.week_start::date) = tw.week_start_kst;


부수 효과: week_start 컬럼이 timestamp여도 (week_start::date)로 비교해 타입 미스매치를 회피.

3) 메타 조인 방식 정리 (title/artist는 DB, 커버는 Spotify)

(기존) LEFT JOIN musics m ON m.id = rw.music_id 하고, m.album_image까지 DB에서 반환.

(최종)

title/artist: 당신이 지정한 대로 music 테이블과 music_id로 LEFT JOIN해서 가져옴.

LEFT JOIN music m ON m.music_id = rw.music_id
SELECT m.title AS music_title, m.artist AS music_artist


앨범 표지(cover): DB 컬럼 대신 Spotify Search API로 조회해서 album_image_url로 내려줌.

클라이언트 크리덴셜 토큰 발급(인메모리 캐시)

track:title artist:artist 쿼리로 검색 → album.images[0].url 추출

(제목/가수 동일 요청) 이미지 URL 인메모리 캐시로 중복 호출 최소화

(결과 스키마) 프론트에서 쓰는 music_title, music_artist, album_image_url 그대로 유지.
(장르는 필요 시 music 테이블에서 추가하거나, 지금은 null 유지)

4) 월간 쿼리도 동일 스키마로 통일

(기존) 월간도 DB의 album_image를 그대로 내려줌.

(최종) 주간과 동일하게 music 조인으로 title/artist를 붙이고, 커버는 Spotify로 채워 album_image_url 제공.

5) 에러 로그/구조 소소한 정리

콘솔 로그 태그를 rankings/weekly, rankings/monthly 등으로 일관되게 정리.

실패 응답 키를 { error: "..." } 형식으로 단순화.

### server.js 코드 수정 (1013)
🔧 1️⃣ 핵심 변화 — rankings 라우터 두 경로로 등록
✔ 기존
[ "/api/rankings", "routes/rankings" ],


/api/rankings/* 경로만 인식

프론트가 /api/rankings-simple/*으로 요청하면 404 발생

🔥 수정 후
// rankings는 두 경로로 동시 마운트 (404 방지용)
[ "/api/rankings", "routes/rankings" ],
[ "/api/rankings-simple", "routes/rankings" ],


👉 즉, 같은 라우터 파일(routes/rankings.js)을 /api/rankings와 /api/rankings-simple 둘 다에 등록해서
프론트 요청이 어느 쪽으로 오든 정상 응답하도록 바꾼 거야.
이게 지금 404 에러(특히 Render 배포 환경) 해결의 핵심 포인트야.

### rankings.js 코드 수정 (1014)
하루 통계로 순위 변동을 계산하는 로직으로 변경