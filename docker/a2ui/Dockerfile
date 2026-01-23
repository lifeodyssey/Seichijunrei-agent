FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install uv (used only to export a locked requirements.txt)
RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock /app/
RUN uv export --frozen --no-dev --format requirements-txt -o /tmp/requirements.txt \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt

# Copy only what the A2UI service needs.
COPY interfaces /app/interfaces
COPY application /app/application
COPY infrastructure /app/infrastructure
COPY services /app/services
COPY clients /app/clients
COPY config /app/config
COPY domain /app/domain
COPY utils /app/utils

ENV A2UI_BACKEND=agent_engine

CMD ["python", "-m", "interfaces.a2ui_web.server"]
