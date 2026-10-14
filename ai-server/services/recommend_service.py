# services/recommend_service.py

class RecommendService:
    @staticmethod
    def get_recommendation(face_emotion, scene_tags, rule_tags):
        final_mood = "Default"

        # ----------------------------------------------
        # 이 안에 수많은 if / elif 규칙을 만드는 것이 핵심!
        # ----------------------------------------------
        if face_emotion == 'happy' and 'beach' in scene_tags and 'day' in rule_tags:
            final_mood = "신나는 여름 휴가"
        
        elif face_emotion == 'sad' and 'night' in rule_tags and 'cool/blue' in rule_tags:
            final_mood = "쓸쓸한 새벽 감성"
            
        elif 'cafe' in scene_tags and 'calm/peaceful' in rule_tags:
            final_mood = "나른한 오후의 카페"
        
        # ... 여기에 수많은 창의적인 규칙을 추가 ...

        # 최종 분위기에 맞는 음악 추천
        music_map = {
            "신나는 여름 휴가": ["Upbeat Pop", "Tropical House"],
            "쓸쓸한 새벽 감성": ["Lo-fi", "Ballad"],
            "나른한 오후의 카페": ["Jazz", "Acoustic"],
            "Default": ["Today's Top Hits"]
        }
        
        recommended_playlist = music_map.get(final_mood, music_map["Default"])
        
        return final_mood, recommended_playlist