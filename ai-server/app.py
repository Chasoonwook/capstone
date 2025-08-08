# backend/app.py

from fastapi import FastAPI, UploadFile, File
from services.rulebase_service import analyze_photo
from services.emotion_service import predict_emotion_combined  # CNN + DeepFace
from services.yolo_service import analyze_yolo
from services.recommend_service import recommend_music
from utils.preprocess import preprocess_image
import shutil
import os

app = FastAPI()

@app.post("/analyze/")
async def analyze(file: UploadFile = File(...)):
    try:
        # 1. 파일 저장
        save_path = f"temp_{file.filename}"
        print(f"[INFO] 파일 저장: {save_path}")
        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 2. 전처리
        preprocessed_path = preprocess_image(save_path)
        print(f"[INFO] 전처리 결과 경로: {preprocessed_path}")

        # 3. 감정 예측 (CNN + DeepFace 개별 결과)
        emotion_result = predict_emotion_combined(preprocessed_path)
        print(f"[INFO] 감정 예측 결과: {emotion_result}")

        if "error" in emotion_result:
            raise ValueError(emotion_result["error"])

        cnn_emotion = emotion_result["cnn"]
        cnn_conf = emotion_result["cnn_conf"]
        deepface_emotion = emotion_result["deepface"]
        deepface_conf = emotion_result["deepface_conf"]

        # 4. Rule-based 감정 분석
        rule_result = analyze_photo(preprocessed_path)
        rule_emotion = rule_result['emotion_label']
        print(f"[INFO] Rule 기반 분석 결과: {rule_result}")

        # 5. YOLO 객체 탐지 및 장소 분류
        yolo_result = analyze_yolo(preprocessed_path)
        print(f"[INFO] YOLO 분석 결과: {yolo_result}")

        # 6. 음악 추천 (CNN + DeepFace + Rule 기반 동적 가중치)
        recommend_result = recommend_music(
            cnn_emotion=cnn_emotion,
            cnn_conf=cnn_conf,
            deepface_emotion=deepface_emotion,
            deepface_conf=deepface_conf,
            rule_emotion=rule_emotion
        )
        print(f"[INFO] 추천 결과: {recommend_result}")

        # 7. 임시 파일 삭제
        os.remove(save_path)
        print(f"[INFO] 임시 파일 삭제 완료: {save_path}")

        # 8. 결과 반환
        return {
            "cnn_emotion": cnn_emotion,
            "cnn_confidence": cnn_conf,
            "deepface_emotion": deepface_emotion,
            "deepface_confidence": deepface_conf,
            "rule_emotion": rule_emotion,
            "final_emotion": recommend_result["final_emotion"],
            "recommended_music": recommend_result["recommended_music"],
            "weights": recommend_result["weights"],
            "scores": recommend_result["scores"],
            "objects": yolo_result["objects"],
            "category": yolo_result["category"],
            "brightness": rule_result["brightness"],
            "avg_rgb": rule_result["avg_rgb"],
            "time_label": rule_result["time_label"],
            "color_label": rule_result["color_label"]
        }

    except Exception as e:
        print(f"[ERROR] {e}")
        return {"error": str(e)}
