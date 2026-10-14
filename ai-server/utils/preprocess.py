# utils/preprocess.py

import torchvision.transforms as transforms

# 이미지 크기 (학습시킨 모델과 동일해야 함)
IMG_SIZE = 48 

# 학습 시 사용할 데이터 증강 및 전처리
train_transform = transforms.Compose([
    transforms.RandomHorizontalFlip(),
    transforms.RandomRotation(15),
    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]) # 3채널용 정규화
])

# 검증 및 실제 추론 시 사용할 전처리
inference_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
])