# backend/services/recommend_service.py
# 감정 통합 (CNN + DeepFace + Rule) 및 음악 추천

def recommend_music(cnn_emotion: str, cnn_conf: float, deepface_emotion: str, deepface_conf: float, rule_emotion: str) -> dict:
    # 1. 고정 가중치 또는 confidence 기반 가중치 합산
    rule_weight = 0.8  # Rule은 confidence가 없으므로 고정 가중치 사용

    total_weight = cnn_conf + deepface_conf + rule_weight

    cnn_weight = cnn_conf / total_weight
    df_weight = deepface_conf / total_weight
    rule_w = rule_weight / total_weight

    # 2. 감정 스코어 초기화 및 가중치 누적
    emotion_scores = {}

    for label in [cnn_emotion, deepface_emotion, rule_emotion]:
        emotion_scores[label] = 0.0

    emotion_scores[cnn_emotion] += cnn_weight
    emotion_scores[deepface_emotion] += df_weight
    emotion_scores[rule_emotion] += rule_w

    # 3. 가장 높은 점수의 감정 선택
    final_emotion = max(emotion_scores.items(), key=lambda x: x[1])[0]

    # 4. 감정 → 음악 추천 매핑
    emotion_to_music = {
        'happy/lively': ['Dynamite - BTS', 'Happy - Pharrell Williams'],
        'romantic/dreamy': ['IU - Through The Night', 'Crush - Beautiful'],
        'lonely/quiet': ['Paul Kim - Me After You', 'Ed Sheeran - Photograph'],
        'sad/heavy': ['이승철 - 소녀시대', 'Adele - Someone Like You'],
        'passionate/energetic': ['ZICO - 아무노래', 'Twice - Feel Special'],
        'calm/peaceful': ['AKMU - 어떻게 이별까지 사랑하겠어', 'Lauv - I Like Me Better'],
        'pure/innocent': ['태연 - 만약에', 'Lena Park - In Dreams'],
        'neutral/balanced': ['10cm - 폰서트', 'IU - 블루밍'],
    }

    recommended_music = emotion_to_music.get(final_emotion, ['Default Song'])

    return {
        "final_emotion": final_emotion,
        "recommended_music": recommended_music,
        "weights": {
            "cnn": round(cnn_weight, 3),
            "deepface": round(df_weight, 3),
            "rule": round(rule_w, 3)
        },
        "scores": emotion_scores
    }
