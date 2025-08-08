# backend/services/yolo_service.py

# YOLO 서비스
from ultralytics import YOLO
import os

# 경로 설정
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YOLO_DETECT_PATH = os.path.join(BASE_DIR, "models", "yolo", "detect_best.pt")
YOLO_CLASSIFY_PATH = os.path.join(BASE_DIR, "models", "yolo", "classify_best.pt")

# 모델 로딩
detect_model = YOLO(YOLO_DETECT_PATH)
classify_model = YOLO(YOLO_CLASSIFY_PATH)

# 분석 함수
def analyze_yolo(image_path_or_array):
    # 1. 객체 탐지
    try:
        detect_result = detect_model(image_path_or_array)[0]
        if detect_result.boxes.cls is not None:
            objects = [detect_model.names[int(cls)] for cls in detect_result.boxes.cls]
        else:
            objects = []
    except Exception as e:
        print(f"[YOLO Detect Error] {e}")
        objects = []

    # 2. 이미지 분류
    try:
        classify_result = classify_model(image_path_or_array)[0]
        if classify_result.probs is not None:
            probs = classify_result.probs.data.tolist()
            top_class_index = probs.index(max(probs))
            label = classify_model.names[top_class_index]
        else:
            label = "Unknown"
    except Exception as e:
        print(f"[YOLO Classify Error] {e}")
        label = "Unknown"

    return {
        "objects": objects,
        "category": label  # 장소 또는 전체 이미지 분류 결과
    }
