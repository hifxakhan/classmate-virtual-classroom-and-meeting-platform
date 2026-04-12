FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PIP_DEFAULT_TIMEOUT=600
ENV PIP_RETRIES=10
ENV PIP_NO_CACHE_DIR=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgomp1 \
    postgresql-client \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install basic tools
RUN pip install --no-cache-dir --upgrade pip wheel setuptools

# Copy requirements first (better cache behavior)
COPY code/my-react-app/src/ClassMate-Backend/requirements.txt .

# Install Python packages with retries and binary preference for more reliable cloud builds
RUN pip install --prefer-binary -r requirements.txt

# Copy the rest of the application
COPY code/my-react-app/src/ClassMate-Backend/ .

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--worker-class", "sync", "--timeout", "120", "app:app"]
