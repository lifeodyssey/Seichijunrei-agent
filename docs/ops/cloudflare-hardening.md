# Cloudflare Hardening Runbook

## Scope

This runbook captures Cloudflare dashboard changes that are intentionally not stored in Git:

- `/v1/*` WAF and rate-limit controls
- coarse prompt-injection edge filtering
- rollback procedure for over-blocking rules
- the future AI Gateway insertion point

For the full deployment topology, auth flow, and env-var boundaries see `deployment.md` in this directory.

## Request Flow

```text
Browser / API client
  │
  ▼
Cloudflare Edge (Worker: worker/worker.js)
  ├─ static paths (/, /about, *.js, *.css, …) ──▶ ASSETS binding (frontend/out/)
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy → Anitabi CDN (cached)
  ├─ /healthz ───────────────────────────────────▶ RuntimeContainer (no auth)
  └─ /v1/* ── authenticate ── strip Authorization
       │        inject X-User-Id, X-User-Type
       ▼
     RuntimeContainer (Durable Object → Python FastAPI on port 8080)
       ├─ Supabase Postgres (SUPABASE_DB_URL)
       ├─ Anitabi API (ANITABI_API_URL)
       └─ Gemini model provider (GEMINI_API_KEY)
```

## Auth Flow

Two credential types, both validated at the Worker edge:

| Credential | Format | Validation |
|---|---|---|
| Human JWT | `Bearer <supabase_jwt>` | `validateJwt()` calls Supabase `/auth/v1/user` with `SUPABASE_ANON_KEY` |
| Agent API key | `Bearer sk_<hex>` | `validateApiKey()` SHA-256 hashes the key, looks up `api_keys` table via Supabase REST with `SUPABASE_SERVICE_ROLE_KEY` |

On success the Worker sets `X-User-Id` and `X-User-Type`, deletes the `Authorization` header, and forwards to the container. The container never sees raw bearer tokens.

## Env Var Boundary

| Variable | Boundary | Notes |
|---|---|---|
| `SUPABASE_URL` | Worker-only | Used for JWT validation and API-key lookup |
| `SUPABASE_ANON_KEY` | Worker-only | Passed as `apikey` header to Supabase auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker-only | Used for `api_keys` table lookup |
| `SUPABASE_DB_URL` | Container-only | Direct Postgres connection for asyncpg |
| `GEMINI_API_KEY` | Container-only | LLM provider credential |
| `ANITABI_API_URL` | Container-only | Pilgrimage data API |
| `CORS_ALLOWED_ORIGIN` | Container-only | Backend CORS allowlist |
| `GOOGLE_MAPS_API_KEY` | Container-only (optional) | Geocoding |
| `LOGFIRE_TOKEN` | Container-only (optional) | Observability |
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend build-time only | Injected by CI, not a runtime secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend build-time only | Injected by CI, not a runtime secret |

The full container env allowlist is defined in `worker/worker.js` as `CONTAINER_REQUIRED_ENV_KEYS`, `CONTAINER_RUNTIME_ENV_KEYS`, and `CONTAINER_OPTIONAL_ENV_KEYS`.

## Current Trust Boundary

- Browser and API clients talk only to the Worker hostname
- Worker-only auth secrets stay at the edge: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Container runtime receives only its explicit allowlist from `worker/worker.js`
- Backend auth trust starts from `X-User-Id` and `X-User-Type`, not from raw bearer tokens

## 1. `/v1/*` Rate Limit Rule

Cloudflare dashboard path:

- Security → WAF → Rate limiting rules

Recommended rule:

- Expression: `http.host eq "seichijunrei.zhenjia.org" and starts_with(http.request.uri.path, "/v1/")`
- Counting characteristic: source IP
- Threshold: `60` requests
- Period: `1 minute`
- Action: `Block`
- Response: `429` if the zone plan exposes custom response options; otherwise keep Cloudflare default block handling

Notes:

- leave `/healthz` outside this rule
- do not include static asset paths
- if trusted internal automation needs higher throughput later, add a narrowly-scoped bypass instead of loosening the global rule

## 2. Prompt-Injection Coarse Filter

Cloudflare dashboard path:

- Security → WAF → Custom rules

Goal:

- block obviously hostile prompt text before it reaches Worker logs or model-provider spend
- keep this filter coarse and reversible

Suggested phrases:

- `ignore previous instructions`
- `system prompt`
- `output your prompt`
- `pretend you are`

Safer baseline expression when only URI/query inspection is available:

```text
http.host eq "seichijunrei.zhenjia.org"
and starts_with(http.request.uri.path, "/v1/")
and (
  lower(http.request.uri.query) contains "ignore previous instructions"
  or lower(http.request.uri.query) contains "system prompt"
  or lower(http.request.uri.query) contains "output your prompt"
  or lower(http.request.uri.query) contains "pretend you are"
)
```

Operational guidance:

- start with `Managed Challenge` if you are unsure about false positives
- switch to `Block` only after observing clean hits
- if your Cloudflare plan supports request-body inspection for custom WAF rules, extend the same phrase list there
- if body inspection is unavailable, keep this query/header-only rather than reimplementing ad-hoc content filtering in the Worker
- this is only a coarse edge filter; application-level prompt guardrails still remain required

## 3. AI Gateway Insertion Point

If AI Gateway is enabled later:

- place it between the container and Gemini
- do not place it in the browser
- do not place it in the Worker

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional container-only env

Before enabling it, backend model configuration must support provider base-URL override through env. Until that exists, keep AI Gateway disabled and treat this section as a forward path only.

## 4. Rollback Procedure

If legitimate traffic is blocked:

1. disable the custom prompt-injection rule first
2. keep the `/v1/*` rate-limit rule enabled unless it is the clear source of the incident
3. inspect Worker logs for `401`, `429`, and upstream `5xx` spikes
4. only then reintroduce narrower filters

If the rate limit is too aggressive:

1. raise the threshold above `60 req/min/IP`, or
2. switch action from `Block` to `Managed Challenge`

If an app deploy is at fault instead of WAF:

1. revert and redeploy the app separately
2. leave WAF changes untouched unless they contributed to the incident
3. verify `/healthz`, `/v1/runtime`, and static asset delivery independently

## 5. Post-Change Verification

After manual dashboard changes:

- confirm `/healthz` still succeeds without auth
- confirm `/v1/runtime` still requires auth and returns `401` when missing credentials
- confirm a valid authenticated `/v1/runtime` request still reaches the backend
- confirm static frontend assets remain unaffected
- inspect Worker logs for unexpected spikes in blocked traffic or auth failures
