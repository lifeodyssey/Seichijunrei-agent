# Operations Docs

Operational runbooks and environment-facing procedures live here.

Use this directory for:

- deployment and rollback procedures
- Cloudflare hardening and edge-routing notes
- observability and incident-response runbooks
- other long-lived operational docs that are not iteration-specific

Current canonical docs:

- `deployment.md` — Cloudflare Workers + Containers deployment runbook (topology, auth flow, env boundaries, rollback)
- `cloudflare-hardening.md` — WAF rate limiting, prompt-injection filtering, rollback for edge rules

Keep iteration task trackers, progress logs, and findings under `docs/iterations/`.
