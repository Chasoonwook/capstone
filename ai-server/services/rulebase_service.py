# backend/services/rulebase_service.py
import os
from PIL import Image
import numpy as np

def analyze_photo(image_path):
    img = Image.open(image_path).convert('RGB')
    arr = np.array(img)

    brightness = arr.mean()
    avg_r = arr[:, :, 0].mean()
    avg_g = arr[:, :, 1].mean()
    avg_b = arr[:, :, 2].mean()

    # 시간대 예측
    if brightness > 120:
        time_label = 'day'
    elif 60 < brightness <= 120:
        if avg_g > avg_r * 1.2 and avg_g > avg_b * 1.2:
            time_label = 'day'
        else:
            time_label = 'sunset'
    else:
        if avg_g > avg_r * 1.3 and avg_g > avg_b * 1.3:
            time_label = 'day'
        else:
            time_label = 'night'

    # 색조 분류
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

    # 색조 → 감정 매핑
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
    emotion_label = color_to_emotion[color_label]

    return {
        'brightness': brightness,
        'avg_rgb': (avg_r, avg_g, avg_b),
        'time_label': time_label,
        'color_label': color_label,
        'emotion_label': emotion_label
    }
