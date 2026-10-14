# services/yolo_service.py (YOLOv8 Classification)

import os
from ultralytics import YOLO
from PIL import Image

class YoloSceneService:
    def __init__(self, model_path='models/yolo_scene_cls/train/weights/best.pt'): # 👈 실제 파일 위치에 맞게 경로를 수정했습니다.
        """
        클래스가 생성될 때 YOLO 분류 모델을 한 번만 로드합니다.
        """
        self.model = YOLO(model_path)
        print("✅ YOLO Scene Classification model loaded.")

    def predict(self, image_path: str) -> list:
        """
        이미지 경로를 받아 장소/상황을 분석하고,
        예측된 카테고리 이름을 리스트에 담아 반환합니다.
        """
        # PIL을 사용해 이미지 열기
        img = Image.open(image_path).convert("RGB")

        # 모델로 예측 수행
        results = self.model(img, verbose=False)[0] # 첫 번째 결과 사용

        # 분류 결과에서 가장 확률이 높은 클래스 정보 추출
        top1_index = int(results.probs.top1)
        category_name = results.names[top1_index]
        
        # 다른 서비스와의 호환성을 위해 예측된 카테고리를 리스트에 담아 반환합니다.
        return [category_name]