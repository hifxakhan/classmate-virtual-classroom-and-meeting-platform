FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    postgresql-client \
    libpq-dev \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install build helpers for heavy packages
RUN pip install --no-cache-dir --upgrade pip wheel setuptools

# Copy requirements first (better cache behavior)
COPY code/my-react-app/src/ClassMate-Backend/requirements.txt .

# Install Python packages with timeout suitable for large wheels
RUN pip install --no-cache-dir --default-timeout=300 -r requirements.txt

# Copy backend code
COPY code/my-react-app/src/ClassMate-Backend/ .

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--worker-class", "sync", "--timeout", "120", "--workers", "2", "app:app"]
