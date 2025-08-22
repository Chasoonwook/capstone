# app.py (for Hugging Face Spaces Docker deployment)
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

# (서버-서버 호출이면 불필요하지만, 프론트 직접 호출 시를 대비해 옵션으로 둠)
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
# 모델 파일 확보 + 레거시 호환 패치
# =========================
MODEL_DIR = Path("models/emotion")
MODEL_PATH = MODEL_DIR / "emotion_cnn.h5"

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
        raise RuntimeError("Missing model and no download info provided")

    try:
        if gdrive_id:
            import gdown
            gdown.download(id=gdrive_id, output=str(MODEL_PATH), quiet=False)
        else:
            with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
                r.raise_for_status()
                with open(MODEL_PATH, "wb") as f:
                    for chunk in r.iter_bytes():
                        f.write(chunk)
        if not MODEL_PATH.exists() or MODEL_PATH.stat().st_size < 10 * 1024:
            raise RuntimeError("Downloaded model looks invalid or too small.")
    except Exception as e:
        raise RuntimeError(f"Model download failed: {e}")

def _patch_legacy_h5_batch_shape(path: Path):
    """
    일부 구형 Keras 저장본(h5)이 'batch_shape' 키를 써서 tf.keras 로딩 시
    'Unrecognized keyword arguments: [batch_shape]' 에러가 발생한다.
    H5의 model_config를 in-place로 'batch_input_shape'로 치환한다.
    (없으면 조용히 스킵)
    """
    try:
        import h5py, numpy as np  # requirements.txt에 h5py 포함 필수
        if not path.exists():
            return
        with h5py.File(str(path), "r+") as f:
            mc = f.attrs.get("model_config")
            if mc is None:
                return
            s = mc.decode("utf-8") if isinstance(mc, (bytes, bytearray)) else str(mc)
            if '"batch_shape":' in s and '"batch_input_shape":' not in s:
                s2 = s.replace('"batch_shape":', '"batch_input_shape":')
                f.attrs.modify("model_config", np.string_(s2))
                print("[compat] patched model_config: batch_shape -> batch_input_shape")
    except Exception as e:
        # 패치 실패는 치명적이지 않게 로그만 남김
        print(f"[compat] h5 patch skipped: {e}")

# =========================
# 지연 import/로드 (콜드 스타트 최적화)
# =========================
_lazy_loaded = False

def _lazy_imports():
    global _lazy_loaded
    if _lazy_loaded:
        return

    ensure_models()
    _patch_legacy_h5_batch_shape(MODEL_PATH)  # ← 레거시 h5 호환 패치

    # 무거운 의존성/모델은 엔드포인트 호출 시점에 import
    global analyze_photo, predict_emotion_combined, analyze_yolo, recommend_music, preprocess_image
    from services.rulebase_service import analyze_photo
    from services.emotion_service import predict_emotion_combined  # CNN + DeepFace 조합
    from services.yolo_service import analyze_yolo
    from services.recommend_service import recommend_music
    from utils.preprocess import preprocess_image

    _lazy_loaded = True

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
        # 프론트 매핑 핵심
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
    _lazy_imports()  # ← 첫 호출 시에만 무거운 것들 로드

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

# ---------- 헬스/루트 ----------
@app.get("/")
def root():
    return {"ok": True, "name": APP_NAME}

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
    except HTTPException:
        raise
    except Exception as e:
        # 내부 에러 메시지를 그대로 노출 (운영 시에는 마스킹 고려)
        raise HTTPException(400, str(e))
    finally:
        try:
            os.remove(tmp_name)
        except Exception:
            pass

# ---------- image_url로 분석 ----------
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

            # 파일 유효성 간단 검증
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
