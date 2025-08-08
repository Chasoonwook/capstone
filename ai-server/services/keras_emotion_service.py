# backend/services/keras_emotion_service.py

import os
import numpy as np
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing import image

# 모델 경로 설정 (절대경로)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(BASE_DIR, "models", "emotion", "emotion_cnn_fixed.keras")
model = load_model(MODEL_PATH, compile=False)

# 예측 함수
def predict_emotion_keras(img_path):
    try:
        # 이미지 불러오기 및 전처리
        img = image.load_img(img_path, target_size=(224, 224), color_mode='rgb')
        img_array = image.img_to_array(img) / 255.0
        img_array = np.expand_dims(img_array, axis=0)

        # 예측
        predictions = model.predict(img_array)[0]  # [0]: (1, 7) → (7,)
        class_names = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral']

        return predictions.tolist(), class_names  # softmax 확률과 클래스 반환

    except Exception as e:
        print(f"[Keras Emotion Service ERROR] {e}")
        raise e
