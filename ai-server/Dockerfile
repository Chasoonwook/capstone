FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 && \
    rm -rf /var/lib/apt/lists/*

# 비루트 사용자
RUN useradd -m -u 1000 appuser

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    DEEPFACE_HOME=/tmp \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

# /tmp 하위 캐시 디렉토리들 생성(모두 쓰기 가능)
RUN install -d -m 1777 /tmp && \
    install -d -m 1777 /tmp/.deepface && \
    install -d -m 1777 /tmp/Ultralytics

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chown -R appuser:appuser /app

USER appuser
EXPOSE 7860
CMD ["python","-m","uvicorn","app:app","--host","0.0.0.0","--port","7860","--workers","1","--limit-concurrency","4","--timeout-keep-alive","5"]
