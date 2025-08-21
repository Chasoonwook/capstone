# app.py
import os, uuid, shutil
from io import BytesIO
from pathlib import Path
from PIL import Image

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
import httpx

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

# =========================
# 모델 파일 확보 + 지연 로드
# =========================
MODEL_DIR = Path("models/emotion")
MODEL_PATH = MODEL_DIR / "emotion_cnn.h5"   # 너희 서비스가 읽는 경로

def ensure_models():
    """
    서버에 모델 파일이 없으면 내려받아 채워 넣는다.
    EMOTION_MODEL_URL 또는 EMOTION_MODEL_GDRIVE_ID 중 하나가 필요.
    """
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.exists():
        return

    url = os.getenv("EMOTION_MODEL_URL")
    gdrive_id = os.getenv("EMOTION_MODEL_GDRIVE_ID")
    if not url and not gdrive_id:
        raise RuntimeError(
            "Missing model file and no EMOTION_MODEL_URL/EMOTION_MODEL_GDRIVE_ID set."
        )

    try:
        if gdrive_id:
            # Google Drive 다운로드 (gdown 필요)
            import gdown
            gdown.download(id=gdrive_id, output=str(MODEL_PATH), quiet=False)
        else:
            # 일반 HTTP(S) URL 다운로드
            with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
                r.raise_for_status()
                with open(MODEL_PATH, "wb") as f:
                    for chunk in r.iter_bytes():
                        f.write(chunk)

        # 최소 크기 체크(깨진 파일 방지)
        if not MODEL_PATH.exists() or MODEL_PATH.stat().st_size < 10 * 1024:
            raise RuntimeError("Downloaded model looks invalid or too small.")
    except Exception as e:
        raise RuntimeError(f"Model download failed: {e}")

def _lazy_imports():
    """
    무거운 라이브러리 import와 모델 로드는 엔드포인트 호출 시점에!
    (헬스체크는 가볍게 통과)
    """
    ensure_models()  # h5가 반드시 존재하도록 보장

    # === 너희 서비스 로직 (지연 import) ===
    global analyze_photo, predict_emotion_combined, analyze_yolo, recommend_music, preprocess_image
    from services.rulebase_service import analyze_photo
    from services.emotion_service import predict_emotion_combined  # CNN + DeepFace
    from services.yolo_service import analyze_yolo
    from services.recommend_service import recommend_music
    from utils.preprocess import preprocess_image

# ---------- 공용 유틸 ----------
def _normalize_emotion(e: str | None) -> str | None:
    if not e:
        return None
    e = e.strip().lower()
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
    bg = (yolo_result or {}).get("category") or fallback
    return (bg or "unknown").strip().lower()

def _build_response(rule_result, emotion_result, yolo_result, rec):
    cnn_emotion = emotion_result["cnn"]
    cnn_conf = emotion_result["cnn_conf"]
    deepface_emotion = emotion_result["deepface"]
    deepface_conf = emotion_result["deepface_conf"]

    rule_emotion = rule_result["emotion_label"]
    time_label = rule_result.get("time_label")
    color_label = rule_result.get("color_label")
    brightness = rule_result.get("brightness")
    avg_rgb = rule_result.get("avg_rgb")

    background = _background_from(yolo_result)
    final_emotion = rec["final_emotion"]
    normalized_emotion = _normalize_emotion(final_emotion)

    return {
        # 백엔드 매핑 핵심 3개
        "time_label": time_label,
        "background": background,
        "emotion": normalized_emotion,

        # 참고값
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
    _lazy_imports()  # ← 무거운 것들 호출 시에만 로드

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

    # 5) 가중치/최종 감정
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

# ---------- 업로드 파일로 분석 ----------
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

# ---------- image_url로 분석(동기 Push) ----------
class PredictReq(BaseModel):
    image_url: str
    photo_id: str | None = None
    user_id: str | None = None
    fetch_headers: dict | None = None  # 필요 시 Authorization 등

@app.post("/predict")
async def predict(req: PredictReq):
    tmp_name = f"/tmp/{uuid.uuid4().hex}.jpg"
    try:
        # 서버→서버 이미지 다운로드
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

            if len(r.content) > MAX_IMAGE_MB * 1024 * 1024:
                raise HTTPException(413, f"image too large (> {MAX_IMAGE_MB}MB)")

            Image.open(BytesIO(r.content)).verify()

            with open(tmp_name, "wb") as f:
                f.write(r.content)

        out = _run_pipeline(tmp_name)
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
