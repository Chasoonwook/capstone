# 1. 베이스 이미지 설정 (Python 3.11-slim)
# ⭐️ 파이썬 버전을 3.11로 수정했습니다.
FROM python:3.11-slim

# 2. 시스템 라이브러리 설치 (OpenCV 구동에 필요)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 libgomp1 && \
    rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉터리 설정
WORKDIR /app

# 4. 파이썬 환경 변수 설정
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 5. 라이브러리 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 6. 프로젝트 전체 파일 복사
COPY . .

# 7. 비루트 사용자 생성 및 권한 설정
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

# 8. 비루트 사용자로 전환
USER appuser

# 9. 포트 노출
EXPOSE 7860

# 10. 서버 실행 명령어
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]