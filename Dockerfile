FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Only need ffmpeg for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip

# Copy requirements first (better cache behavior)
COPY code/my-react-app/src/ClassMate-Backend/requirements.txt .

RUN pip install --no-cache-dir --prefer-binary -r requirements.txt

# Copy the rest of the application
COPY code/my-react-app/src/ClassMate-Backend/ .

RUN mkdir -p uploads/profile_images

EXPOSE 8080

CMD if [ "$PRELOAD_WHISPER_MODEL" = "true" ]; then \
        python -c "from whisper_client import get_whisper_model; get_whisper_model('${WHISPER_MODEL_SIZE:-base}')"; \
    fi && \
    gunicorn app:app --bind 0.0.0.0:8080 --worker-class gevent --timeout 120 --reuse-port
