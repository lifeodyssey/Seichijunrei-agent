# Progress Log

## 2026-03-18

- Explored the codebase and selected the v2 direction
- Chose Pydantic AI over the earlier architecture
- Defined Supabase as the primary data system
- Wrote the initial refactor plan and supporting findings

## 2026-03-19

- Implemented `IntentAgent`
- Implemented `SQLAgent`
- Added eval coverage for intent classification
- Implemented `PlannerAgent`, `ExecutorAgent`, and `pipeline`

## 2026-03-21

- Audited the repo and confirmed the core Plan-and-Execute runtime already existed
- Removed the parallel step-agent experiment
- Removed legacy interface code, docs, and tests
- Rewrote the repo docs to one v2 architecture story

## 2026-03-21 — Retrieval MVP

- Added a deterministic retriever layer above `SQLAgent`
- Implemented `sql`, `geo`, and `hybrid` strategy selection
- Integrated the retriever into `ExecutorAgent` query execution
- Added unit coverage for strategy selection and executor integration

## 2026-03-21 — Retrieval Cache And Fallback

- Added retriever-side response caching for repeated deterministic queries
- Added `search_by_bangumi` / `plan_route` DB-miss fallback to Anitabi point fetch
- Added write-through persistence back into Supabase when fallback returns points
- Added a safe geography upsert path for fallback-loaded point rows
- Added unit coverage for cache hits, fallback writes, and Supabase geography upserts

## 2026-03-21 — Executor Response Surface

- Normalized `query_db` and `plan_route` step payloads with explicit status and summary fields
- Kept `format_response` running after executor failures so partial/error responses are still structured
- Added top-level response `status` and `message` propagation in final pipeline output
- Added notices for cache hits, write-through results, and geo fallback conditions
- Added unit coverage for empty results, formatted failures, and executor notices

## 2026-03-21 — Public Runtime API

- Added a thin public facade over `run_pipeline` in `interfaces/public_api.py`
- Defined stable request/response and error payload schemas for future HTTP or RPC adapters
- Added optional debug output so external callers can inspect plans and step results without binding to internal classes
- Added unit coverage for success, failure, validation, and exception mapping through the public facade

## 2026-03-21 — Session Persistence And Route History

- Added session-aware public API requests with optional `session_id`
- Persisted session state through the configured session store and mirrored it into Supabase when available
- Added route history tracking on successful route responses
- Persisted route records via Supabase `save_route` when the database adapter exposes it
- Added unit coverage for session reuse, session summaries, and route history persistence

## 2026-03-21 — HTTP Service And Container Path

- Added `interfaces/http_service.py` as a thin `aiohttp` adapter over `RuntimeAPI`
- Exposed `GET /healthz` and `POST /v1/runtime` as deployable backend endpoints
- Added service host/port and session-backend deployment settings
- Added a container image build target via `Dockerfile`
- Documented the local container run path and the Cloudflare-compatible container deployment shape
- Added unit coverage for HTTP request validation, service lifecycle, and runtime endpoint mapping

## 2026-03-21 — OpenTelemetry Runtime Instrumentation

- Added request-level spans and metrics around the HTTP service middleware
- Added runtime-level spans and metrics around `RuntimeAPI.handle()`
- Added observability settings for exporter type, OTLP endpoint, and service identity
- Added startup and shutdown wiring for OpenTelemetry providers in the HTTP service
- Added unit coverage for observability lifecycle and runtime/http metric recording

## 2026-03-21 — Acceptance Baseline

- Added integration acceptance cases covering bangumi search, location search, route planning, and unclear input
- Added a JSON baseline file to freeze expected runtime/public-API behavior
- Compared `run_pipeline` output and `handle_public_request` output against the same baseline scenarios
- Split stable acceptance runs from model-backed eval runs in the Makefile so CI-safe tests do not depend on external LLM availability

## 2026-04-01 — Auth fixes + CI/deploy pipeline hardening

- **Auth UX**: After "Send login link" the form now replaces with a success card (check_email_heading / check_email_body) rather than just adding a small status line. "Back" link restores the form.
- **Cross-browser magic link**: Switched both `AuthGate` and `AuthCallbackPage` Supabase clients to `flowType: 'implicit'`. PKCE was failing when the email link opened in a different browser (no `code_verifier` in localStorage). Implicit flow embeds the session in the URL hash fragment — works from any browser.
- **Cloudflare Containers**: Removed GHCR image push from CI (GHCR is not a supported Cloudflare registry). `wrangler deploy` now builds and pushes directly to Cloudflare's registry.
- **Wrangler 4**: `cloudflare/wrangler-action@v3` defaults to wrangler 3 which silently ignores `[[containers]]`. Added `wranglerVersion: "4.79.0"` to the action.
- **Orphaned DO namespace**: Deleted the `seichijunrei-runtimecontainer` application that wrangler 3 had created with the wrong namespace ID before re-deploying with wrangler 4.
- **Observability**: Added `[observability]`, `[observability.logs]`, and `[observability.traces]` blocks to `wrangler.toml`.
- **i18n routing**: Replaced URL-based `app/[lang]/` locale routing with `localStorage`-based detection (`lib/i18n.ts detectLocale()`). AuthGate now reads locale from `useLocale()` context.

## Current Status

- Core runtime is in place
- Legacy interface branches are removed
- `sql/geo/hybrid` retrieval is in place with cache and DB-miss fallback
- Executor output is normalized for ok, empty, partial, and error states
- A thin public API layer now wraps `run_pipeline`
- Session state and route history persist across public API calls
- Planner receives a structured context block derived from session + user memory
- SSE streaming endpoint (`/v1/runtime/stream`) is available and wired to the frontend client
- Onboarding + selected-point routing paths exist (`greet_user`, `plan_selected`)
- An HTTP service and Cloudflare Containers deployment path now exist (wrangler 4, auto-deploy on push to main)
- OpenTelemetry tracing and metrics hooks are now wired into the runtime
- Acceptance baselines now cover the main runtime flows end to end
- Auth: implicit flow magic links, success-card UX after send
- Docs are kept in sync in `README.md`, `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `CLAUDE.md`

## 2026-04-03 — Repo hygiene + docs sync

- Ignored local Playwright MCP state (`.playwright-mcp/`) and moved scratch images under `images/`
- Updated all Markdown docs to match the current runtime + frontend behavior
