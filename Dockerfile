FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

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

# Install Python packages with timeout suitable for large wheels
RUN pip install --no-cache-dir --default-timeout=300 -r requirements.txt

# Copy the rest of the application
COPY code/my-react-app/src/ClassMate-Backend/ .

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--worker-class", "sync", "--timeout", "120", "app:app"]
