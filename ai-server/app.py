# backend/app.py
import os, uuid, shutil
from io import BytesIO
from PIL import Image

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
import httpx

# === 너희 서비스 로직 ===
from services.rulebase_service import analyze_photo
from services.emotion_service import predict_emotion_combined  # CNN + DeepFace
from services.yolo_service import analyze_yolo
from services.recommend_service import recommend_music
from utils.preprocess import preprocess_image

APP_NAME = "ai-photo"
MAX_IMAGE_MB = int(os.getenv("MAX_IMAGE_MB", "15"))
FETCH_TIMEOUT = float(os.getenv("FETCH_TIMEOUT", "30"))

app = FastAPI(title=APP_NAME)

# (서버-서버 통신이라 CORS는 필수 아님) 필요하면 .env 에 ALLOWED_ORIGIN 추가
allowed_origin = os.getenv("ALLOWED_ORIGIN")
if allowed_origin:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[allowed_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ---------- 공용 유틸 ----------
def _normalize_emotion(e: str | None) -> str | None:
    if not e:
        return None
    e = e.strip().lower()
    # DeepFace/CNN 결과들 표준 7클래스로 정규화
    mapping = {
        "angry": "angry", "anger": "angry",
        "disgust": "disgust", "disgusted": "disgust",
        "fear": "fear", "afraid": "fear",
        "happy": "happy", "happiness": "happy",
        "neutral": "neutral",
        "sad": "sad", "sadness": "sad",
        "surprise": "surprise", "surprised": "surprise",
    }
    return mapping.get(e, e)

def _background_from(yolo_result: dict, fallback=None):
    # yolo_service.analyze_yolo()가 category를 주고 있음
    bg = (yolo_result or {}).get("category") or fallback
    return (bg or "unknown").strip().lower()

def _build_response(rule_result, emotion_result, yolo_result, rec):
    cnn_emotion = emotion_result["cnn"]
    cnn_conf = emotion_result["cnn_conf"]
    deepface_emotion = emotion_result["deepface"]
    deepface_conf = emotion_result["deepface_conf"]

    rule_emotion = rule_result["emotion_label"]
    time_label = rule_result.get("time_label")   # 'day' / 'night' 등
    color_label = rule_result.get("color_label")
    brightness = rule_result.get("brightness")
    avg_rgb = rule_result.get("avg_rgb")

    background = _background_from(yolo_result)
    final_emotion = rec["final_emotion"]
    normalized_emotion = _normalize_emotion(final_emotion)

    return {
        # 백엔드 매핑용 핵심 3개 ↓↓↓
        "time_label": time_label,
        "background": background,       # 예: cafe/city/gym/park...
        "emotion": normalized_emotion,  # angry/disgust/fear/happy/neutral/sad/surprise

        # 참고/디버그용 세부 값
        "cnn_emotion": cnn_emotion,
        "cnn_confidence": cnn_conf,
        "deepface_emotion": deepface_emotion,
        "deepface_confidence": deepface_conf,
        "rule_emotion": rule_emotion,
        "final_emotion": final_emotion,
        "recommended_music": rec.get("recommended_music"),
        "weights": rec.get("weights"),
        "scores": rec.get("scores"),
        "objects": (yolo_result or {}).get("objects"),
        "category": (yolo_result or {}).get("category"),
        "brightness": brightness,
        "avg_rgb": avg_rgb,
        "color_label": color_label,
    }

def _run_pipeline(saved_path: str) -> dict:
    # 1) 전처리
    preprocessed_path = preprocess_image(saved_path)

    # 2) 감정 예측(CNN + DeepFace)
    emotion_result = predict_emotion_combined(preprocessed_path)
    if "error" in emotion_result:
        raise ValueError(emotion_result["error"])

    # 3) Rule-based
    rule_result = analyze_photo(preprocessed_path)

    # 4) YOLO
    yolo_result = analyze_yolo(preprocessed_path)

    # 5) 최종 감정/가중치 -> recommend_service (내부 가중치 계산)
    rec = recommend_music(
        cnn_emotion=emotion_result["cnn"],
        cnn_conf=emotion_result["cnn_conf"],
        deepface_emotion=emotion_result["deepface"],
        deepface_conf=emotion_result["deepface_conf"],
        rule_emotion=rule_result["emotion_label"],
    )

    return _build_response(rule_result, emotion_result, yolo_result, rec)

# ---------- 헬스체크 ----------
@app.get("/healthz")
def healthz():
    return {"ok": True, "name": APP_NAME}

# ---------- 업로드 파일로 분석(기존 유지) ----------
@app.post("/analyze/")
async def analyze(file: UploadFile = File(...)):
    tmp_name = f"/tmp/{uuid.uuid4().hex}_{file.filename}"
    try:
        with open(tmp_name, "wb") as f:
            shutil.copyfileobj(file.file, f)
        out = _run_pipeline(tmp_name)
        return out
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        try:
            os.remove(tmp_name)
        except Exception:
            pass

# ---------- image_url로 분석(백엔드 동기 Push용) ----------
class PredictReq(BaseModel):
    image_url: str
    photo_id: str | None = None
    user_id: str | None = None
    fetch_headers: dict | None = None  # 필요 시 Authorization 등

@app.post("/predict")
async def predict(req: PredictReq):
    tmp_name = f"/tmp/{uuid.uuid4().hex}.jpg"
    try:
        # 서버→서버로 이미지 다운로드 (리다이렉트 허용)
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
            headers=req.fetch_headers or {"User-Agent": "ai-fetcher/1.0"},
        ) as client:
            r = await client.get(req.image_url)
            if r.status_code != 200:
                raise HTTPException(400, f"fetch failed: {r.status_code}")

            ctype = r.headers.get("content-type", "")
            if "image" not in ctype:
                raise HTTPException(415, f"unsupported content-type: {ctype}")

            # 크기 제한
            if len(r.content) > MAX_IMAGE_MB * 1024 * 1024:
                raise HTTPException(413, f"image too large (> {MAX_IMAGE_MB}MB)")

            # 고장난 이미지 방지
            Image.open(BytesIO(r.content)).verify()

            with open(tmp_name, "wb") as f:
                f.write(r.content)

        out = _run_pipeline(tmp_name)
        # 백엔드가 그대로 쓰기 좋게 핵심 3개 필드 + 참고값 반환
        return {
            "photo_id": req.photo_id,
            "user_id": req.user_id,
            **out,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        try:
            os.remove(tmp_name)
        except Exception:
            pass
