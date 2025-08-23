FROM python:3.11-slim

# 필수 런타임 라이브러리
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 && \
    rm -rf /var/lib/apt/lists/*

# 런타임 환경 변수 및 쓰기 가능한 캐시 디렉토리 준비
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    DEEPFACE_HOME=/tmp/.deepface \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

RUN mkdir -p /tmp/.deepface /tmp/Ultralytics

WORKDIR /app

# 먼저 의존성만 캐시되도록 복사 → 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 소스 복사
COPY . .

EXPOSE 7860

# uvicorn 실행 (동시성 약간 허용)
CMD ["python","-m","uvicorn","app:app","--host","0.0.0.0","--port","7860","--workers","1","--limit-concurrency","4","--timeout-keep-alive","5"]
