# MoodTune

> 사진 한 장의 분위기를 읽어, 그 순간에 어울리는 음악을 추천하는 웹 서비스

사진 속 **얼굴 표정**, **장소**, **색감과 밝기**를 AI로 분석해 사진의 분위기를 파악하고, 그에 맞는 음악을 추천합니다.
추천받은 곡은 Spotify로 바로 재생하고, 사진과 음악을 함께 포토 다이어리로 기록할 수 있습니다.

캡스톤 디자인 프로젝트 · 개발 기간 2025.07 ~ 2025.12

<br>

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 사진 분석 | 업로드한 사진에서 표정 감정, 장소, 시간대·색감 분위기를 추출 |
| 음악 추천 | 분석 결과를 바탕으로 사진 분위기에 어울리는 곡 추천 |
| Spotify 재생 | OAuth(Authorization Code + PKCE)로 계정을 연동하고, Web Playback SDK로 브라우저에서 바로 재생·일시정지·이전/다음 곡 |
| 미리듣기 | Deezer / iTunes 미리듣기 지원 (Next.js API Route로 프록시) |
| 사진 꾸미기 | 스티커를 붙이고 배치하는 캔버스 편집기 (Fabric.js, Konva) |
| 포토 다이어리 | 사진과 추천곡에 제목·내용을 붙여 일기로 저장 |
| 히스토리 · 랭킹 | 지난 분석 기록 다시 보기, 곡 순위와 순위 변동 표시 |
| 곡 추가 요청 | 추천 목록에 없는 곡을 검색해 추가 요청 |
| 온보딩 | 회원가입 후 선호 장르 선택 (K-POP, POP, Hip-hop, J-POP, 클래식, 트로트 등 9개) |

<br>

## 시스템 구조

```mermaid
flowchart LR
    U([사용자]) --> F["Frontend<br/>Next.js 15 · React 19"]
    F -- REST API --> B["Backend API<br/>Express · PostgreSQL"]
    B -- 사진 분석 요청 --> A["AI Server<br/>FastAPI"]
    B -- 검색 · 토큰 --> SW["Spotify Web API"]
    F -- 재생 제어 --> S["Spotify<br/>Web Playback SDK"]
    F -- 미리듣기 --> P["Deezer / iTunes"]

    subgraph AI["AI 분석 파이프라인"]
        A --> E["표정 감정 분류<br/>MobileNetV2"]
        A --> Y["장소 분류<br/>YOLOv8-cls"]
        A --> R["색감·밝기 분석<br/>규칙 기반"]
    end
```

**요청 흐름**

1. 사용자가 사진을 올리면 Frontend가 Backend의 `POST /api/photos/analyze`로 보냅니다.
2. Backend는 이미지를 AI Server의 `POST /analyze/`로 넘겨 감정·장소·색감 분석을 받습니다.
3. Backend가 원본 이미지와 분석 결과를 PostgreSQL에 저장하고, `mood_mapping` 테이블로 메인·서브 무드를 정합니다.
4. Frontend가 `GET /api/recommendations/by-photo/:photoId`로 추천 곡 10개를 받아 보여줍니다.

<br>

## AI 분석 파이프라인

사진 한 장을 세 갈래로 분석한 뒤 하나의 결과로 합칩니다.

| 단계 | 방법 | 출력 예 |
| --- | --- | --- |
| **표정 감정** | OpenCV Haar Cascade로 얼굴 검출 → 가장 큰 얼굴을 224×224로 잘라 MobileNetV2 기반 Keras 모델로 분류 | `happy` (7종: angry, disgust, fear, happy, neutral, sad, surprise) |
| **장소 분류** | YOLOv8n 분류 모델을 직접 학습 | `cafe` (9종: beach, bedroom, cafe, classroom, gym, mountain, nature, park, street) |
| **색감·밝기** | 평균 밝기와 RGB 분포로 시간대·색조를 판정하고, 색조를 분위기 태그로 매핑 | `day`, `green/nature`, `calm/peaceful` |

**응답 예시** (`POST /analyze/`)

```json
{
  "emotion": "happy",
  "background": "cafe",
  "detail_tags": {
    "scene": ["cafe"],
    "rule": ["day", "yellow/bright", "happy/lively"]
  }
}
```

### 장소 분류 모델 학습 결과

| 항목 | 값 |
| --- | --- |
| 베이스 모델 | `yolov8n-cls` |
| 입력 크기 / 에폭 / 배치 | 224 / 20 / 16 |
| 검증 Top-1 정확도 | **93.9%** (최고, 16 에폭) · 93.7% (최종) |
| 검증 Top-5 정확도 | 99.8% |
| 클래스별 정확도 | 89% (cafe, park) ~ 100% (bedroom) |

<p align="center">
  <img src="ai-server/models/yolo_scene_cls/train/confusion_matrix_normalized.png" width="48%" alt="정규화 혼동 행렬">
  <img src="ai-server/models/yolo_scene_cls/train/results.png" width="48%" alt="학습 곡선">
</p>

<br>

## 추천 알고리즘

분석 결과로 정한 무드와 사용자 정보를 섞어 **10곡**을 고릅니다.

| 몫 | 곡 수 | 후보 |
| --- | --- | --- |
| 메인 무드 | 5 | 사진의 메인 무드에 맞는 곡 |
| 서브 무드 · 장소 | 2 | 장소가 인식되면(beach, cafe, mountain 등) 그 장소에 어울리는 곡, 아니면 서브 무드 곡 |
| 선호 장르 | 3 | 온보딩에서 고른 장르의 곡 |

후보 중에서는 점수에 비례한 **가중 무작위 추출**로 뽑아, 같은 사진이라도 매번 조금씩 다른 목록이 나옵니다.

```
점수 = 무드 가중치(메인 1.0 / 서브 0.7) + 곡 피드백 점수 + 0.3 × 인기도 + 0.2 × 최신성
```

곡 피드백 점수는 사용자가 누른 좋아요·싫어요를 합산하되, 오래된 피드백일수록 영향이 줄도록 지수 감쇠(τ = 30일)를 적용합니다.

<br>

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Radix UI, Fabric.js, Konva |
| Backend | Node.js, Express 5, PostgreSQL (pg), JWT (httpOnly 쿠키), bcrypt, Multer |
| AI Server | Python, FastAPI, TensorFlow / Keras, Ultralytics YOLOv8, OpenCV |
| 외부 연동 | Spotify Web API · Web Playback SDK, Deezer API, iTunes Search API |
| 배포 | Docker, Hugging Face Spaces (AI Server), Render (Backend) |

<br>

## 폴더 구조

```
capstone/
├── frontend/                  # Next.js 웹 클라이언트
│   └── src/
│       ├── app/               # 페이지 (recommend, editor, diary, onboarding, login …)
│       │   └── api/preview/   # Deezer · iTunes 미리듣기 프록시
│       ├── components/        # 플레이어, 히스토리, 업로드, 헤더, UI 컴포넌트
│       ├── contexts/          # 재생 상태, Spotify 연결 상태
│       ├── hooks/             # 데이터 조회 훅 (history, diaries, rankings …)
│       └── lib/               # API 클라이언트, Spotify SDK 래퍼
├── backend/                   # Express REST API 서버
│   ├── server.js              # 미들웨어, CORS, 라우터 마운트
│   ├── db.js                  # PostgreSQL 연결 풀
│   └── routes/                # auth, photos, recommendations, spotify, rankings, diaries …
└── ai-server/                 # FastAPI 사진 분석 서버
    ├── app.py                 # API 엔드포인트, 분석 파이프라인
    ├── services/              # 감정 · 장소 · 규칙 기반 분석
    ├── models/                # 라벨 정보, 학습 결과 (가중치는 미포함)
    └── Dockerfile
```

<br>

## 실행 방법

### Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:3000
```

`frontend/.env.local`에 다음 값을 설정합니다.

```bash
NEXT_PUBLIC_API_BASE=<Backend API 주소>
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=<Spotify 앱 Client ID>
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://localhost:3000/spotify-callback
SPOTIFY_CLIENT_SECRET=<Spotify 앱 Client Secret>   # 토큰 갱신용, 서버에서만 사용
```

### Backend

```bash
cd backend
npm install
node server.js         # http://localhost:5000
```

`backend/.env`에 다음 값을 설정합니다.

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB
JWT_SECRET=<임의의 긴 문자열>
IMG_TOKEN_SECRET=<임의의 긴 문자열>
AI_BASE_URL=<AI Server 주소>
FRONT_BASE=http://localhost:3000
SPOTIFY_CLIENT_ID=<Spotify 앱 Client ID>
SPOTIFY_CLIENT_SECRET=<Spotify 앱 Client Secret>
SPOTIFY_REDIRECT_URI=<Spotify 콜백 주소>
```

### AI Server

```bash
cd ai-server
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 7860
```

또는 Docker로 실행합니다.

```bash
cd ai-server
docker build -t moodtune-ai .
docker run -p 7860:7860 moodtune-ai
```

학습된 모델 가중치는 저장소에 포함되어 있지 않습니다. 다음 위치에 넣은 뒤 실행하세요.

- `ai-server/models/emotion/emotion_model.h5`
- `ai-server/models/yolo_scene_cls/train/weights/best.pt`

<br>

## 기여자

| 이름 | 담당 |
| --- | --- |
| [@Chasoonwook](https://github.com/Chasoonwook) | AI Server 전체, Backend (Spotify 연동, 사진 업로드·이미지 처리), Frontend |
| [@Jinyoung0725](https://github.com/Jinyoung0725) | Frontend, Backend (추천, 랭킹, 인증, 히스토리) |
| [@MinJ01](https://github.com/MinJ01) | Backend (서버 초기 구조, DB 연동, 사진·스티커 API) |

<br>

## 저장소 이력

여러 저장소에 나뉘어 있던 코드를 커밋 기록을 유지한 채 하나로 합쳤습니다.

| 원본 저장소 | 위치 | 비고 |
| --- | --- | --- |
| `capstone_front` | `frontend/` | 최신 프론트엔드 |
| `capstone_full` | `frontend/` (기록) | 초기 통합본. 같은 기록에서 갈라진 사본이라 커밋 기록만 병합 |
| `capstone_AI` | `ai-server/` | AI 서버 초기 버전 (CNN + DeepFace + 규칙 기반) |
| `ai-photo-server` | `ai-server/` | AI 서버 정리 버전. `capstone_AI` 기록에 이어 붙임 |
| `MinJ01/CAPSTONE_APP_BACK` | `backend/` | 백엔드 API 서버 |

AI 서버의 이전 버전 코드는 커밋 기록에서 확인할 수 있습니다. 학습된 모델 가중치 파일은 용량 문제로, 백엔드에 커밋돼 있던 `node_modules`와 환경 변수 파일은 보안과 용량 문제로 기록에서 제외했습니다.
