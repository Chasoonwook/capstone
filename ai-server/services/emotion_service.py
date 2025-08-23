# services/emotion_service.py

import os
from pathlib import Path
import numpy as np

# ★ 환경변수로 주입된 경로(패치된 /tmp 파일 포함)를 우선 사용
MODEL_PATH = Path(os.getenv("EMOTION_MODEL_PATH", "models/emotion/emotion_cnn.h5"))

# DeepFace 기준 7개 클래스
CLASS_NAMES = ["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]

# 지연 로드용 싱글톤
_cnn_model = None

# DeepFace detector 백엔드 (무거운 mtcnn 대신 기본 opencv 권장)
DEEPFACE_HOME = os.getenv("DEEPFACE_HOME", "/tmp/.deepface")
os.environ["DEEPFACE_HOME"] = DEEPFACE_HOME
Path(DEEPFACE_HOME).mkdir(parents=True, exist_ok=True)


def _get_cnn_model():
    """
    최초 1회만 tf.keras 모델 로드.
    - 오래된 저장본의 dtype policy 직렬화 이름 'DTypePolicy'를
      tf.keras의 Policy에 매핑해 커스텀 객체로 등록.
    """
    global _cnn_model
    if _cnn_model is None:
        import tensorflow as tf

        # tf.keras 2.15의 dtype policy 클래스
        Policy = getattr(tf.keras.mixed_precision, "Policy", None)

        # 커스텀 오브젝트 스코프: 'DTypePolicy' → Policy
        custom = {}
        if Policy is not None:
            custom["DTypePolicy"] = Policy  # config: {'name': 'float32'} 등

        # 이 스코프 안에서 load_model을 호출하면 직렬화명이 매핑됨
        cm = tf.keras.utils.custom_object_scope(custom) if custom else None
        try:
            if cm:
                cm.__enter__()
            _cnn_model = tf.keras.models.load_model(str(MODEL_PATH), compile=False)
        finally:
            if cm:
                cm.__exit__(None, None, None)

    return _cnn_model


def _preprocess_for_cnn(img_path: str):
    import tensorflow as tf
    img = tf.keras.utils.load_img(img_path, target_size=(224, 224), color_mode="rgb")
    arr = tf.keras.utils.img_to_array(img).astype("float32") / 255.0
    arr = np.expand_dims(arr, axis=0)  # (1, 224, 224, 3)
    return arr


def _safe_softmax(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype="float32")
    x = x - np.max(x)
    e = np.exp(x)
    s = e.sum()
    return e / s if s > 0 else np.zeros_like(x)


def _predict_with_deepface(img_path: str):
    """
    DeepFace의 반환형이 dict 또는 [dict] 일 수 있어 안전하게 처리.
    """
    from deepface import DeepFace

    df = DeepFace.analyze(
        img_path=img_path,
        actions=["emotion"],
        enforce_detection=False,
        detector_backend=DEEPFACE_BACKEND,
    )

    if isinstance(df, list) and len(df) > 0:
        df = df[0]
    scores = df.get("emotion", {}) if isinstance(df, dict) else {}

    # 클래스 순서를 고정해서 벡터 생성
    pred = np.array([float(scores.get(k, 0.0)) for k in CLASS_NAMES], dtype="float32")
    s = float(pred.sum())
    if s > 0:
        pred /= s

    label = CLASS_NAMES[int(np.argmax(pred))] if pred.size else "neutral"
    conf = float(np.max(pred)) if pred.size else 0.0
    return label, conf


def predict_emotion_combined(img_path: str):
    try:
        # (1) CNN 예측
        model = _get_cnn_model()
        arr = _preprocess_for_cnn(img_path)
        cnn_pred = model.predict(arr, verbose=0)[0]

        # 확률 분포가 아닐 수 있으니 정규화 (logits 대비)
        if not (0.98 <= float(cnn_pred.sum()) <= 1.02):
            cnn_pred = _safe_softmax(cnn_pred)

        # CNN이 6개 감정만 학습한 경우 → 'disgust' 자리에 0 삽입
        if len(cnn_pred) == 6:
            cnn_pred = np.insert(cnn_pred, 1, 0.0)

        cnn_label = CLASS_NAMES[int(np.argmax(cnn_pred))]
        cnn_conf = float(np.max(cnn_pred))

        # (2) DeepFace 예측
        df_label, df_conf = _predict_with_deepface(img_path)

        # (3) 결과 반환 (최종 감정은 recommend_service에서 계산)
        return {
            "cnn": cnn_label,
            "cnn_conf": round(cnn_conf, 4),
            "deepface": df_label,
            "deepface_conf": round(df_conf, 4),
        }

    except Exception as e:
        return {"error": f"[Emotion Service ERROR] {e}"}
