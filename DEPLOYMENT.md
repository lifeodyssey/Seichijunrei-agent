# Deployment

## Current State

The repository does not currently ship a production deployment target.

The active runtime is the backend Plan-and-Execute core. Deployment work is
deferred until retrieval and execution capabilities stabilize.

## Intended V2 Shape

- Compute: containerized Python service
- Data: Supabase/Postgres + PostGIS
- Optional edge/runtime target: Cloudflare-compatible deployment path
- Observability: OpenTelemetry

## Minimum Preconditions Before Deployment

1. Stable public API or service entry point
2. Agentic retriever integrated into executor
3. Session persistence story decided
4. End-to-end tests covering the main route-planning flow

## Environment Baseline

- `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANITABI_API_URL`
- model/provider credentials used by pydantic-ai

## Near-Term Recommendation

Do not build deployment automation on top of legacy ADK or UI assumptions.
Finish the runtime surface first, then add a thin service wrapper and deploy that.
