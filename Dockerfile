FROM public.ecr.aws/docker/library/python:3.11-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.10.9 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY pyproject.toml uv.lock README.md /app/

RUN uv sync --frozen --extra redis --no-dev --no-install-project

COPY agents /app/agents
COPY application /app/application
COPY clients /app/clients
COPY config /app/config
COPY contracts /app/contracts
COPY domain /app/domain
COPY infrastructure /app/infrastructure
COPY interfaces /app/interfaces
COPY services /app/services
COPY utils /app/utils

RUN uv sync --frozen --extra redis --no-dev

FROM public.ecr.aws/docker/library/python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    APP_ENV=production \
    SERVICE_HOST=0.0.0.0 \
    SERVICE_PORT=8080

WORKDIR /app

COPY --from=builder /app /app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"SERVICE_PORT\", \"8080\")}/healthz', timeout=3)"

CMD ["python", "-m", "interfaces.http_service"]
