# capstone_AI
---
title: ai-photo
sdk: docker
app_port: 7860
---

# AI Photo API (YOLO + DeepFace + CNN)
- `GET  /healthz`
- `POST /analyze/`  (multipart: file)
- `POST /predict`   (json: {"image_url": "...", ...})
