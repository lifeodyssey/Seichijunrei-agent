# Deployment

This is the canonical deployment runbook for the current runtime.
The root `DEPLOYMENT.md` file remains as a compatibility pointer for older links.

## Edge Topology

```text
Browser
  ├─ static paths ───────────────────────────────▶ Cloudflare ASSETS
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy/cache
  ├─ /healthz ───────────────────────────────────▶ Worker → RuntimeContainer → FastAPI service
  └─ /v1/* ── auth at Worker edge ───────────────▶ Worker → RuntimeContainer → FastAPI service
                                                            ├─ Supabase Postgres (`SUPABASE_DB_URL`)
                                                            ├─ Anitabi API (`ANITABI_API_URL`)
                                                            └─ Gemini provider (`GEMINI_API_KEY`)
```

- `interfaces/fastapi_service.py` exposes `GET /healthz`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime/stream` (SSE)
- `interfaces/fastapi_service.py` exposes `POST /v1/feedback`
- `Dockerfile` packages the runtime into a single container image

The deployment target stays intentionally thin. The Worker owns routing and edge auth; the container runs the backend service and stays unaware of raw end-user credentials.

## Trust Boundaries

| Layer | Responsibility | Secrets/config it should see |
|---|---|---|
| Frontend build | Static export only | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Worker edge | Route match, JWT/API-key auth, identity injection | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Container runtime | Backend service, DB, model/provider calls | `SUPABASE_DB_URL`, `GEMINI_API_KEY`, `ANITABI_API_URL`, `CORS_ALLOWED_ORIGIN`, optional observability keys |

Current hardening rule: the Worker strips the raw `Authorization` header before proxying and forwards only trusted `X-User-Id` / `X-User-Type` identity headers to the container.

## Auth Flow

Worker auth is implemented in `worker/worker.js`:

- JWT flow: `validateJwt()` calls `SUPABASE_URL/auth/v1/user` with `SUPABASE_ANON_KEY`
- API key flow: `validateApiKey()` hashes the presented `sk_*` token and looks it up through Supabase REST using `SUPABASE_SERVICE_ROLE_KEY`
- Forwarding flow: the Worker injects `X-User-Id` and `X-User-Type`, deletes `Authorization`, and proxies the request to `CONTAINER`

Auth expectations:

- `/v1/*` always requires `Authorization: Bearer ...`
- `/healthz` and static assets bypass auth
- the container trusts only the Worker-injected identity headers; it is not the auth enforcement point

## Local Service Run

Install dependencies and start the service:

```bash
uv sync --extra dev
make serve
```

Default bind settings:

- `SERVICE_HOST=0.0.0.0`
- `SERVICE_PORT=8080`

## Environment by Boundary

### Worker edge

Required at deploy time:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

These secrets stay in the Worker environment and are not forwarded into the container runtime.

### Container runtime

Required:

- `SUPABASE_DB_URL`
- provider credentials for the configured model backend (`GEMINI_API_KEY` today)

Common runtime config:

- `ANITABI_API_URL`
- `CORS_ALLOWED_ORIGIN`
- `DEFAULT_AGENT_MODEL`
- `LOG_LEVEL`
- `MAX_RETRIES`
- `TIMEOUT_SECONDS`
- `OBSERVABILITY_ENABLED`
- `OBSERVABILITY_EXPORTER_TYPE`
- `OBSERVABILITY_OTLP_ENDPOINT`
- `OBSERVABILITY_SERVICE_NAME`
- `OBSERVABILITY_SERVICE_VERSION`
- `LOGFIRE_TOKEN` (optional)
- `GOOGLE_MAPS_API_KEY` (optional)

Session storage:

- the backend currently uses the in-memory session store only

### Frontend build-time env

Required during `frontend` build only:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

These are injected in GitHub Actions during the static export step and are not runtime container secrets.

## Container Path

Build the image locally:

```bash
docker build -t seichijunrei-runtime .
```

Run the image locally:

```bash
docker run --rm -p 8080:8080 \
  -e SUPABASE_DB_URL \
  -e ANITABI_API_URL \
  -e GEMINI_API_KEY \
  -e CORS_ALLOWED_ORIGIN \
  seichijunrei-runtime
```

Smoke test:

```bash
curl http://127.0.0.1:8080/healthz
curl -X POST http://127.0.0.1:8080/v1/runtime \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: local-dev' \
  -H 'X-User-Type: human' \
  -d '{"text":"从京都站出发去吹响的圣地"}'
```

Note: direct container access trusts forwarded identity headers. Bearer-token auth is enforced at the Worker edge, not inside the container process.

## Cloudflare Workers + Containers Path

Production runs on Cloudflare Workers + Containers (backed by a Durable Object container class).
`wrangler deploy` builds the image from `Dockerfile`, uploads it to Cloudflare's container registry, and wires it to `RuntimeContainer`.

Requirements:

- Wrangler 4+ (`[[containers]]` is ignored by Wrangler 3)
- GitHub Actions uses `cloudflare/wrangler-action@v3` with `wranglerVersion: "4.79.0"`
- This repo deploys from the checked-in `Dockerfile`; there is no GHCR handoff

Routing defined by `wrangler.toml`:

- `/v1/*` and `/healthz` run through the Worker and proxy to `CONTAINER`
- `/img/*` runs through the Worker image proxy/cache
- everything else goes to `ASSETS` (`frontend/out/`)

## Deploy Sequence

Automatic production deploy happens in `.github/workflows/ci.yml` on pushes to `main` after required jobs pass.
The current order is:

1. build static frontend export
2. apply Supabase migrations with `supabase db push`
3. run `wrangler deploy`

Manual one-shot deploy remains available through `.github/workflows/deploy.yml` or locally:

```bash
npx wrangler@4 deploy
```

**CF Worker routing** (`worker/worker.js`):

- `/v1/*` and `/healthz` → `CONTAINER` (Durable Object → FastAPI service on port 8080)
- Everything else → `ASSETS` (Next.js static export from `frontend/out/`)

## WAF and Edge Hardening

Manual Cloudflare dashboard steps live in `docs/ops/cloudflare-hardening.md`.
That runbook covers:

- `/v1/*` rate limiting
- coarse prompt-injection WAF filters
- rollback steps for over-blocking rules
- the future AI Gateway insertion point

## AI Gateway Insertion Path

If AI Gateway is enabled later, it belongs between the container and the upstream model provider.
It does not belong in the browser and does not belong in the Worker.

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional container-only env

Important: this is a documentation target only right now. Before enabling it, the backend planner client must support provider base-URL override through env rather than assuming the provider default.

## Rollback

App rollback:

1. revert the offending commit on `main`
2. rerun the production deploy workflow or run `npx wrangler@4 deploy`
3. verify `/healthz`, `/v1/runtime`, and static asset delivery

Worker/container rollback:

1. use Git history as the source of truth for `worker/worker.js`, `wrangler.toml`, and workflow changes
2. redeploy the previous known-good revision
3. treat database rollbacks separately; `wrangler deploy` does not undo Supabase schema changes

WAF rollback:

1. disable the custom prompt-injection rule first
2. keep the `/v1/*` rate limit in place unless it is the source of the incident
3. inspect Worker logs before re-enabling stricter filters

## Known Limitations

- default session storage is in-memory unless a distributed backend is introduced later
- OpenTelemetry exporters are opt-in and disabled by default
- AI Gateway is documented but not yet wired in backend provider configuration
