# backend/services/emotion_service.py

from keras.models import load_model
from keras.preprocessing import image
import numpy as np
from deepface import DeepFace

# CNN 모델 로드
cnn_model = load_model("models/emotion/emotion_cnn.h5", compile=False)

# DeepFace 기준 7개 클래스
class_names = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral']

def predict_emotion_combined(img_path):
    try:
        # (1) CNN 예측
        img = image.load_img(img_path, target_size=(224, 224), color_mode='rgb')
        img_array = image.img_to_array(img) / 255.0
        img_array = np.expand_dims(img_array, axis=0)

        cnn_pred = cnn_model.predict(img_array)[0]

        # CNN이 6개 감정만 학습한 경우 → 'disgust' 자리에 0 삽입
        if len(cnn_pred) == 6:
            cnn_pred = np.insert(cnn_pred, 1, 0.0)

        cnn_label = class_names[np.argmax(cnn_pred)]
        cnn_conf = float(np.max(cnn_pred))

        # (2) DeepFace 예측
        df_result = DeepFace.analyze(img_path=img_path, actions=["emotion"], enforce_detection=False)
        df_scores = df_result[0]["emotion"]
        df_pred = np.array([df_scores[emo] for emo in class_names])
        df_pred = df_pred / np.sum(df_pred)

        df_label = class_names[np.argmax(df_pred)]
        df_conf = float(np.max(df_pred))

        # (3) 결과 반환 (최종 감정은 추천 서비스에서 계산)
        return {
            "cnn": cnn_label,
            "cnn_conf": round(cnn_conf, 4),
            "deepface": df_label,
            "deepface_conf": round(df_conf, 4)
        }

    except Exception as e:
        return {"error": f"[Emotion Service ERROR] {e}"}
