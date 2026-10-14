# AI_PHOTO/app.py

import os
import uuid
import tempfile
from pathlib import Path
import cv2
from fastapi import FastAPI, UploadFile, File, HTTPException
from starlette.middleware.cors import CORSMiddleware

# ----------------- 서비스 import (recommend_service 제외) -----------------
from services.emotion_service import EmotionService
from services.yolo_service import YoloSceneService
from services.rulebase_service import RuleBaseService
# --------------------------------------------------------------------

# 임시 디렉터리 설정
TMP_DIR = Path(os.getenv("TMP_DIR", tempfile.gettempdir()))
TMP_DIR.mkdir(parents=True, exist_ok=True)

# FastAPI 앱 생성
app = FastAPI(title="AI Photo Analysis Server")

# CORS 미들웨어 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- 서비스 객체 미리 생성 -----------------
try:
    emotion_service = EmotionService()
    yolo_service = YoloSceneService()
    rule_service = RuleBaseService()
    print("✅ AI Services loaded successfully.")
except Exception as e:
    print(f"❌ Error loading AI services: {e}")
    emotion_service = yolo_service = rule_service = None
# -----------------------------------------------------------

def run_analysis_pipeline(image_path: str) -> dict:
    """
    이미지 경로를 받아 AI 분석 파이프라인을 실행하고 분석 결과만 반환합니다.
    """
    if not all([emotion_service, yolo_service, rule_service]):
        raise HTTPException(status_code=500, detail="AI services are not available.")

    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"이미지를 불러올 수 없습니다: {image_path}")

    # 각 서비스 실행
    face_emotion = emotion_service.predict(image)
    scene_tags = yolo_service.predict(image_path)
    rule_tags = rule_service.analyze(image)
    
    # 최종 결과 구성 (recommend_service 호출 제외)
    result = {
        "emotion": face_emotion,
        "background": scene_tags[0] if scene_tags else "unknown",
        "detail_tags": {
            "scene": scene_tags,
            "rule": rule_tags
        }
    }
    
    print("--- 분석 결과 ---")
    print(f"👤 얼굴 감정: {result['emotion']}")
    print(f"🏞️ 장소/상황: {result['detail_tags']['scene']}")
    print(f"🎨 규칙 기반 분석: {result['detail_tags']['rule']}")
    print("-----------------\n")

    return result

# ----------------- API 엔드포인트 정의 -----------------
@app.get("/")
def root():
    return {"message": "AI Photo Analysis Server is running."}

# ⭐️ 엔드포인트 경로를 /analyze/ 로 수정
@app.post("/analyze/")
async def analyze_image_upload(file: UploadFile = File(...)):
    """
    이미지 파일을 직접 업로드받아 분석합니다.
    """
    tmp_path = str(TMP_DIR / f"{uuid.uuid4().hex}_{file.filename}")
    
    try:
        with open(tmp_path, "wb") as f:
            f.write(await file.read())
        
        result = run_analysis_pipeline(tmp_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)