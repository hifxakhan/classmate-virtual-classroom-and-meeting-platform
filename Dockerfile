FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install system dependencies including build tools for compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    postgresql-client \
    libpq-dev \
    gcc \
    g++ \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install setuptools first
RUN pip install --upgrade pip setuptools wheel

# Copy requirements
COPY code/my-react-app/src/ClassMate-Backend/requirements.txt .

# Install PyTorch CPU-only first (for Whisper) - smaller footprint
RUN pip install --no-cache-dir torch==2.0.1 --index-url https://download.pytorch.org/whl/cpu

# Install remaining packages
RUN pip install --no-cache-dir Flask==2.3.3 \
    flask-cors==4.0.0 \
    Werkzeug==2.3.3 \
    gunicorn==21.2.0 \
    eventlet==0.33.3 \
    python-dotenv==1.0.0 \
    psycopg2-binary==2.9.9 \
    SQLAlchemy==2.0.20 \
    flask-sqlalchemy==3.0.5 \
    bcrypt==4.1.2 \
    flask-jwt-extended==4.5.2 \
    flask-socketio==5.3.4 \
    python-socketio==5.10.0 \
    python-engineio==4.8.0 \
    requests==2.31.0 \
    python-jwt==1.3.0 \
    openai-whisper==20231117 \
    livekit==0.8.4 \
    livekit-api==0.4.2 \
    numpy==1.24.3

# Copy backend code
COPY code/my-react-app/src/ClassMate-Backend/ .

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# Run gunicorn with eventlet worker for WebSocket support
CMD ["sh", "-c", "gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:${PORT:-8000} --timeout 120 --access-logfile - --error-logfile - app:app"]
