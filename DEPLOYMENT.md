# Deployment

## Current State

The repository now ships a deployable backend service:

- `interfaces/fastapi_service.py` exposes `GET /healthz`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime/stream` (SSE)
- `interfaces/fastapi_service.py` exposes `POST /v1/feedback`
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
- `SUPABASE_ANON_KEY` (required by the Worker for JWT validation)
- `ANITABI_API_URL`
- provider credentials for the configured model backend

Session storage:

- the backend currently uses the in-memory session store only

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

The production deployment runs on Cloudflare Containers (backed by Durable Objects).
`wrangler deploy` builds the image from `Dockerfile`, pushes it to Cloudflare's own
registry, and wires it to the `RuntimeContainer` Durable Object class.

**Requirements:**
- Wrangler 4+ (Containers support was added in v4; v3 silently ignores `[[containers]]`)
- CI uses `cloudflare/wrangler-action@v3` with `wranglerVersion: "4.79.0"` (or newer)
- Only Cloudflare Registry, Docker Hub, and Amazon ECR are supported — GHCR is not

**Deploy via GitHub Actions:**
```bash
gh workflow run deploy.yml -f environment=production
```

CI automatically deploys on every push to `main`.

**Manual one-shot deploy:**
```bash
npx wrangler@4 deploy
```

**CF Worker routing** (`worker/worker.js`):
- `/v1/*` and `/healthz` → `CONTAINER` (Durable Object → FastAPI service on port 8080)
- Everything else → `ASSETS` (Next.js static export from `frontend/out/`)

**Frontend build env vars** required at build time:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

These are injected as `[vars]` in `wrangler.toml` for the Worker, and as `env:` in the
GitHub Actions workflow for the Next.js static build step.

## Known Limitations

- Default session storage is in-memory unless a distributed backend is configured
- OpenTelemetry exporters are opt-in and disabled by default
