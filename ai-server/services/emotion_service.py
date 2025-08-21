# services/emotion_service.py

from pathlib import Path
import numpy as np

# 모델 경로 (app.ensure_models()가 먼저 파일을 내려받아 둠)
MODEL_PATH = Path("models/emotion/emotion_cnn.h5")

# DeepFace 기준 7개 클래스
CLASS_NAMES = ["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]

# 지연 로드용 싱글톤
_cnn_model = None

def _get_cnn_model():
    """
    최초 1회만 Keras 모델을 로드한다.
    (top-level에서 load_model을 호출하지 말 것!)
    """
    global _cnn_model
    if _cnn_model is None:
        import keras  # tf-keras 사용
        _cnn_model = keras.models.load_model(str(MODEL_PATH), compile=False)
    return _cnn_model

def _preprocess_for_cnn(img_path: str):
    import keras  # tf-keras
    img = keras.utils.load_img(img_path, target_size=(224, 224), color_mode="rgb")
    arr = keras.utils.img_to_array(img) / 255.0
    arr = np.expand_dims(arr, axis=0)
    return arr

def _predict_with_deepface(img_path: str):
    """
    DeepFace의 반환형이 dict 또는 [dict] 일 수 있어 안전하게 처리.
    """
    from deepface import DeepFace
    df = DeepFace.analyze(img_path=img_path, actions=["emotion"], enforce_detection=False)

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
