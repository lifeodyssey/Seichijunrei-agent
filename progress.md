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

## Current Status

- Core runtime is in place
- Legacy interface branches are removed
- `sql/geo/hybrid` retrieval is in place with cache and DB-miss fallback
- Executor output is normalized for ok, empty, partial, and error states
- A thin public API layer now wraps `run_pipeline`
- Session state and route history persist across public API calls
- An HTTP service and container deployment path now exist
- Next story is OpenTelemetry instrumentation
