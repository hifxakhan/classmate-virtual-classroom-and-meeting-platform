# Use official Python runtime as base image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies (ffmpeg for audio processing, postgresql-client for DB testing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    postgresql-client \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install setuptools first
RUN pip install --upgrade pip setuptools wheel

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Expose port (Railway/Vercel will override with PORT env var)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health', timeout=5).raise_for_status()" || exit 1

# Run gunicorn with environment variable for port (default to 8000)
CMD ["bash", "-c", "gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:${PORT:-8000} --timeout 120 --access-logfile - --error-logfile - app:app"]