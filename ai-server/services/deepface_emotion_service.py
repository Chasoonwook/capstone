from deepface import DeepFace
import numpy as np

def predict_emotion_deepface(image_path):
    result = DeepFace.analyze(img_path=image_path, actions=['emotion'], enforce_detection=False)
    emotions = result[0]['emotion']

    labels = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral']
    probs = [emotions.get(label, 0.0) / 100 for label in labels]  # 100 → 1.0 정규화
    probs = np.array(probs) / np.sum(probs)  # softmax처럼 정규화
    return probs
