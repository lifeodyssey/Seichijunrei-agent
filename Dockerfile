FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    SERVICE_HOST=0.0.0.0 \
    SERVICE_PORT=8080

WORKDIR /app

COPY . /app

RUN pip install --no-cache-dir ".[redis]"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"SERVICE_PORT\", \"8080\")}/healthz', timeout=3)"

CMD ["python", "-m", "interfaces.http_service"]
