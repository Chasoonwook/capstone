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
# 모델 파일 확보 경로
# =========================
MODEL_DIR = Path("models/emotion")
MODEL_PATH = MODEL_DIR / "emotion_cnn.h5"

def ensure_models():
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

def _patched_model_path() -> Path:
    """
    원본 h5는 읽기 전용일 수 있으므로, 'batch_shape' → 'batch_input_shape' 패치가
    필요하면 /tmp 로 복사본을 만든 뒤 그 복사본을 수정해 사용한다.
    필요 없으면 원본 경로를 그대로 반환.
    """
    ensure_models()
    src = MODEL_PATH
    try:
        import h5py
        # 1) 읽기 전용으로 검사
        needs_patch = False
        with h5py.File(str(src), "r") as f:
            mc = f.attrs.get("model_config")
            if mc is not None:
                s = mc.decode("utf-8") if isinstance(mc, (bytes, bytearray)) else str(mc)
                needs_patch = '"batch_shape":' in s and '"batch_input_shape":' not in s

        if not needs_patch:
            return src

        # 2) /tmp에 복사해서 그 복사본을 패치
        dst = Path("/tmp/emotion_cnn.patched.h5")
        shutil.copyfile(src, dst)
        try:
            os.chmod(dst, 0o644)
        except Exception:
            pass

        import numpy as np
        with h5py.File(str(dst), "r+") as f:
            mc = f.attrs.get("model_config")
            s = mc.decode("utf-8") if isinstance(mc, (bytes, bytearray)) else str(mc)
            s2 = s.replace('"batch_shape":', '"batch_input_shape":')
            f.attrs.modify("model_config", np.string_(s2))
        print(f"[compat] patched model_config -> {dst}")
        return dst
    except Exception as e:
        print(f"[compat] h5 patch failed (non-fatal): {e}")
        return src

# =========================
# 지연 import/로드
# =========================
_lazy_loaded = False

def _lazy_imports():
    global _lazy_loaded
    if _lazy_loaded:
        return

    # 패치된 실제 로드 경로 계산 후 환경변수로 전달
    load_path = _patched_model_path()
    os.environ["EMOTION_MODEL_PATH"] = str(load_path)

    global analyze_photo, predict_emotion_combined, analyze_yolo, recommend_music, preprocess_image
    from services.rulebase_service import analyze_photo
    from services.emotion_service import predict_emotion_combined  # CNN + DeepFace
    from services.yolo_service import analyze_yolo
    from services.recommend_service import recommend_music
    from utils.preprocess import preprocess_image

    _lazy_loaded = True

# ---------- 유틸 ----------
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
        "time_label": time_label,
        "background": background,
        "emotion": normalized_emotion,
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
    _lazy_imports()
    preprocessed_path = preprocess_image(saved_path)

    emotion_result = predict_emotion_combined(preprocessed_path)
    if "error" in emotion_result:
        raise ValueError(emotion_result["error"])

    rule_result = analyze_photo(preprocessed_path)
    yolo_result = analyze_yolo(preprocessed_path)

    rec = recommend_music(
        cnn_emotion=emotion_result["cnn"],
        cnn_conf=emotion_result["cnn_conf"],
        deepface_emotion=emotion_result["deepface"],
        deepface_conf=emotion_result["deepface_conf"],
        rule_emotion=rule_result["emotion_label"],
    )

    return _build_response(rule_result, emotion_result, yolo_result, rec)

# ---------- 라우트 ----------
@app.get("/")
def root():
    return {"ok": True, "name": APP_NAME}

@app.get("/healthz")
def healthz():
    return {"ok": True, "name": APP_NAME}

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
        raise HTTPException(400, str(e))
    finally:
        try:
            os.remove(tmp_name)
        except Exception:
            pass

class PredictReq(BaseModel):
    image_url: str
    photo_id: str | None = None
    user_id: str | None = None
    fetch_headers: dict | None = None

@app.post("/predict")
async def predict(req: PredictReq):
    tmp_name = f"/tmp/{uuid.uuid4().hex}.jpg"
    try:
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
        return {"photo_id": req.photo_id, "user_id": req.user_id, **out}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        try:
            os.remove(tmp_name)
        except Exception:
            pass
