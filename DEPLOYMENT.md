# Deployment

## Current State

The repository now ships a deployable backend service:

- `interfaces/http_service.py` exposes `GET /healthz`
- `interfaces/http_service.py` exposes `POST /v1/runtime`
- `Dockerfile` packages the runtime into a single container image

The deployment target is intentionally thin. The service wraps the existing
Plan-and-Execute runtime instead of introducing a second orchestration layer.

## Local Service Run

Install dependencies and start the service:

```bash
uv sync --extra dev
make serve
```

Default bind settings:

- `SERVICE_HOST=0.0.0.0`
- `SERVICE_PORT=8080`

## Required Environment

- `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANITABI_API_URL`
- provider credentials for the configured model backend

Optional session backend configuration:

- `SESSION_STORE_BACKEND=memory|redis|firestore`
- `SESSION_TTL_SECONDS`
- `REDIS_SESSION_HOST`
- `REDIS_SESSION_PORT`
- `REDIS_SESSION_DB`
- `REDIS_SESSION_PASSWORD`
- `REDIS_SESSION_PREFIX`
- `FIRESTORE_SESSION_COLLECTION`

Optional observability configuration:

- `OBSERVABILITY_ENABLED=true`
- `OBSERVABILITY_EXPORTER_TYPE=none|console|otlp`
- `OBSERVABILITY_OTLP_ENDPOINT`
- `OBSERVABILITY_SERVICE_NAME`
- `OBSERVABILITY_SERVICE_VERSION`

## Container Path

Build the image:

```bash
docker build -t seichijunrei-runtime .
```

Run the image:

```bash
docker run --rm -p 8080:8080 \
  -e SUPABASE_DB_URL \
  -e SUPABASE_URL \
  -e SUPABASE_SERVICE_ROLE_KEY \
  -e ANITABI_API_URL \
  -e GOOGLE_MAPS_API_KEY \
  -e GEMINI_API_KEY \
  seichijunrei-runtime
```

Smoke test:

```bash
curl http://127.0.0.1:8080/healthz
curl -X POST http://127.0.0.1:8080/v1/runtime \
  -H 'Content-Type: application/json' \
  -d '{"text":"从京都站出发去吹响的圣地"}'
```

## Cloudflare Containers Path

The Cloudflare path should reuse the same container image. Keep the runtime in
this repository as a plain HTTP backend and add any Cloudflare-specific Worker
or routing shim outside the core runtime.

Operationally, the deployment path is:

1. Build the container image from this repository
2. Push/deploy that image through a Cloudflare Containers workflow
3. Route external traffic to the containerized `/v1/runtime` endpoint

This keeps the backend architecture identical across local Docker runs and any
future Cloudflare-hosted container deployment.

## Known Limitations

- Default session storage is in-memory unless a distributed backend is configured
- OpenTelemetry exporters are opt-in and disabled by default
- Deployment automation is still manual
