# backend/utils/preprocess.py
import cv2

def preprocess_image(path):
    img = cv2.imread(path)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return path  # 현재는 경로만 반환 (YOLO/DeepFace에서 사용)
