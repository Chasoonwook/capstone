FROM python:3.11-slim

# 필수 런타임 라이브러리
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 && \
    rm -rf /var/lib/apt/lists/*

# 비루트 사용자 생성
RUN useradd -m -u 1000 appuser

# 런타임 환경 변수
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    DEEPFACE_HOME=/tmp/.deepface \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

# /tmp 및 캐시 디렉토리를 모두가 쓸 수 있게(스티키 비트 포함) 생성
RUN install -d -m 1777 /tmp && \
    install -d -m 1777 /tmp/.deepface && \
    install -d -m 1777 /tmp/Ultralytics

WORKDIR /app

# 의존성 먼저 설치(레이어 캐시 최적화)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 소스
COPY . .
RUN chown -R appuser:appuser /app

# 비루트로 실행
USER appuser

EXPOSE 7860
CMD ["python","-m","uvicorn","app:app","--host","0.0.0.0","--port","7860","--workers","1","--limit-concurrency","4","--timeout-keep-alive","5"]
