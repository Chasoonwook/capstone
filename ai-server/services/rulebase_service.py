# backend/services/rulebase_service.py
import numpy as np

class RuleBaseService:
    @staticmethod
    def analyze(image_np: np.ndarray) -> list:
        """
        이미지(numpy array)의 밝기와 색상 분포를 분석하여,
        시간대와 색상 기반 감성 태그를 리스트 형태로 반환합니다.
        예: ['day', 'calm/peaceful']
        """
        # --- 1. 이미지 기본 정보 계산 ---
        # app.py에서 이미지를 한 번만 로드하므로, 여기서는 바로 numpy 배열을 받습니다.
        brightness = image_np.mean()
        avg_r = image_np[:, :, 0].mean()
        avg_g = image_np[:, :, 1].mean()
        avg_b = image_np[:, :, 2].mean()

        # --- 2. 시간대 예측 (기존 로직 유지) ---
        if brightness > 120:
            time_label = 'day'
        elif 60 < brightness <= 120:
            if avg_g > avg_r * 1.2 and avg_g > avg_b * 1.2:
                time_label = 'day' # 숲, 잔디 등 녹색이 강한 주간 이미지
            else:
                time_label = 'sunset'
        else:
            if avg_g > avg_r * 1.3 and avg_g > avg_b * 1.3:
                time_label = 'day' # 야간 조명 아래의 식물 등 예외 처리
            else:
                time_label = 'night'

        # --- 3. 색조 분류 (기존 로직 유지) ---
        if avg_r > avg_g * 1.2 and avg_r > avg_b * 1.2:
            color_label = 'warm/red'
        elif avg_g > avg_r * 1.2 and avg_g > avg_b * 1.2:
            color_label = 'green/nature'
        elif avg_b > avg_r * 1.2 and avg_b > avg_g * 1.2:
            color_label = 'cool/blue'
        elif abs(avg_r - avg_g) < 15 and avg_r > avg_b:
            color_label = 'yellow/bright'
        elif abs(avg_r - avg_b) < 15 and avg_b > avg_g:
            color_label = 'purple/violet'
        elif abs(avg_r - avg_g) < 10 and abs(avg_g - avg_b) < 10 and brightness > 180:
            color_label = 'white/soft'
        elif abs(avg_r - avg_g) < 10 and abs(avg_g - avg_b) < 10 and brightness <= 180:
            color_label = 'gray/muted'
        else:
            color_label = 'neutral'

        # --- 4. 색조 → 감정 매핑 (기존 로직 유지) ---
        color_to_emotion = {
            'warm/red': 'passionate/energetic',
            'green/nature': 'calm/peaceful',
            'cool/blue': 'lonely/quiet',
            'yellow/bright': 'happy/lively',
            'purple/violet': 'romantic/dreamy',
            'white/soft': 'pure/innocent',
            'gray/muted': 'sad/heavy',
            'neutral': 'neutral/balanced'
        }
        # .get()을 사용하면 혹시 모를 key 에러를 방지할 수 있습니다.
        emotion_label = color_to_emotion.get(color_label, 'neutral/balanced')

        # --- 5. 최종 결과 조합 ---
        # 다른 서비스와의 호환성을 위해 분석된 태그들을 리스트로 묶어 반환합니다.
        return [time_label, color_label, emotion_label]