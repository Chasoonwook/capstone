# services/emotion_service.py

import cv2
import json
import numpy as np
import tensorflow as tf
from keras.applications.mobilenet_v2 import preprocess_input 

class EmotionService:
    def __init__(self, model_path='models/emotion/emotion_model.h5', labels_path='models/emotion/emotion_labels.json'):
        self.model = tf.keras.models.load_model(model_path)
        with open(labels_path) as f:
            self.labels = json.load(f)
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    def predict(self, image_np):
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, 1.1, 4)

        if len(faces) == 0:
            return "No Face Detected"

        (x, y, w, h) = sorted(faces, key=lambda f: f[2]*f[3], reverse=True)[0]
        face_roi = image_np[y:y+h, x:x+w]
        
        resized_face = cv2.resize(face_roi, (224, 224))
        
        processed_face = np.expand_dims(resized_face, axis=0)
        processed_face = preprocess_input(processed_face)
        
        prediction = self.model.predict(processed_face, verbose=0)[0]
        predicted_idx = str(np.argmax(prediction))
        
        return self.labels[predicted_idx]