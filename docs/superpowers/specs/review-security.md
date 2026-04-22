# Security Review

Date: 2026-04-22
Scope: frontend + backend + worker

## Summary
- Critical: 0
- High: 1
- Medium: 2
- Low: 2
- Overall posture: STRONG

## Findings

### High
1. CORS defaults to wildcard outside production validation path
- Files: `backend/interfaces/fastapi_service.py`, `backend/config/settings.py`
- Recommendation: ensure `CORS_ALLOWED_ORIGIN` is explicitly set in production deployment.

### Medium
2. Feedback endpoint should validate session ownership when `session_id` is provided
- Recommendation: reject feedback for sessions not owned by current authenticated user.

3. Runtime API leaks internal exception text
- File: `backend/interfaces/public_api.py`
- Recommendation: replace raw exception strings with stable error code + generic message.

### Low
4. Worker identity headers trusted without second attestation
- Files: `backend/interfaces/routes/_deps.py`, `worker/worker.js`
- Recommendation: long-term, add signed internal header or stricter internal-network guarantee.

5. WKT string interpolation for PostGIS geography construction
- File: `backend/infrastructure/supabase/repositories/routes.py`
- Recommendation: use numeric geometry constructors (`ST_MakePoint`).

## Confirmed Good
- Parameterized SQL queries
- No unsafe raw HTML injection with user input detected
- Bearer token auth (CSRF-safe by design)
- RLS enabled on sensitive tables
- Secrets not hardcoded in repo
- Auth header stripped at worker edge
