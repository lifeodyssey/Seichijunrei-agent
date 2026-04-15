# Cloudflare Infra Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Cloudflare edge/runtime setup with explicit WAF rules, AI Gateway integration points, clearer Worker/container env contracts, and deployment/rollback documentation.

**Architecture:** The browser continues to hit Cloudflare Worker routes; the Worker authenticates `/v1/*`, injects trusted identity headers, proxies to the Cloudflare Container, and serves static assets from `ASSETS`. This plan does not change product behavior; it formalizes and hardens the edge boundary and deployment controls.

**Tech Stack:** Cloudflare Worker, Cloudflare Containers, Durable Objects, Wrangler 4, GitHub Actions, Supabase, Gemini.

---

## Context

Current Cloudflare topology is already deployed and working:

- `wrangler.toml` routes `seichijunrei.zhenjia.org/*`
- static frontend served from `ASSETS`
- `/v1/*` and `/healthz` proxied by `worker/worker.js` to `CONTAINER`
- Worker authenticates JWT or `sk_` API key, then injects `X-User-Id` / `X-User-Type`

What is missing is hardening and operational clarity:

- no codified WAF policy for `/v1/*`
- no AI Gateway insertion path documented or wired
- env/secret boundary between Worker and container is broader than necessary
- rollback notes are not explicit

## File Map

| File | Action | Responsibility |
|---|---|---|
| `worker/worker.js` | Modify | Tighten env handling and add explicit comments for security boundaries |
| `wrangler.toml` | Modify | Document/prepare vars/bindings if needed |
| `.github/workflows/ci.yml` | Modify | Clarify deploy secret usage |
| `DEPLOYMENT.md` | Rewrite/Extend | Add infra topology, WAF, AI Gateway, rollback runbook |
| `docs/ops/cloudflare-hardening.md` | Create | Manual dashboard steps for WAF/AI Gateway |

---

### Task 1: Document the current edge topology precisely

**Files:**

- Modify: `DEPLOYMENT.md`
- Create: `docs/ops/cloudflare-hardening.md`

- [ ] **Step 1: Add request flow diagram**

Document:

- Browser → Worker route match
- Static assets → `ASSETS`
- `/v1/*` → auth in Worker → `CONTAINER`
- container → backend service → Supabase / Gemini

- [ ] **Step 2: Add auth flow**

Document JWT flow and API key flow with references to stable symbols/search terms instead of brittle line numbers:

- JWT validation path: `validateJwt()` in `worker/worker.js`
- API key validation path: `validateApiKey()` in `worker/worker.js`
- identity forwarding path: `authenticate()` and the `forwardedHeaders` / `X-User-Id` / `X-User-Type` proxy block in `worker/worker.js`

- [ ] **Step 3: Commit**

```bash
git add DEPLOYMENT.md docs/ops/cloudflare-hardening.md
git commit -m "docs(infra): document Cloudflare request and auth topology"
```

---

### Task 2: Tighten Worker/container env contract

**Files:**

- Modify: `worker/worker.js`
- Modify: `wrangler.toml`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Review `CONTAINER_ENV_KEYS` and trim if possible**

Current list is broad. Split into:

- required runtime keys
- optional observability keys
- legacy/deferred keys

At minimum, add grouping comments and remove obviously unused legacy keys if confirmed unused.

- [ ] **Step 2: Document source of truth for secrets**

Make clear which are:

- Worker-only secrets (`SUPABASE_ANON_KEY` for JWT validation, service role for API key validation)
- Container runtime secrets (`SUPABASE_DB_URL`, provider keys)
- Frontend build-time envs (`NEXT_PUBLIC_*`)

- [ ] **Step 3: Commit**

```bash
git add worker/worker.js wrangler.toml DEPLOYMENT.md
git commit -m "chore(infra): clarify Worker and container env boundaries"
```

---

### Task 3: Add WAF hardening runbook

**Files:**

- Create: `docs/ops/cloudflare-hardening.md`

- [ ] **Step 1: Add `/v1/*` rate-limit rule spec**

Document exact dashboard rule:

- match: `seichijunrei.zhenjia.org/v1/*`
- rate: 60 req/min/IP
- action: block with 429

- [ ] **Step 2: Add prompt-injection edge filter**

Document custom WAF rule for obvious strings:

- `ignore previous instructions`
- `system prompt`
- `output your prompt`
- `pretend you are`

Document as a coarse filter only — application-level guardrails still required.

- [ ] **Step 3: Add rollback steps**

If WAF blocks legitimate traffic:

1. disable custom rule
2. keep rate limit only
3. inspect Worker logs

- [ ] **Step 4: Commit**

```bash
git add docs/ops/cloudflare-hardening.md
git commit -m "docs(infra): add WAF hardening and rollback runbook"
```

---

### Task 4: Add AI Gateway integration plan

**Files:**

- Modify: `DEPLOYMENT.md`
- Modify: `docs/ops/cloudflare-hardening.md`

- [ ] **Step 1: Document insertion point**

The AI Gateway belongs between the container and Gemini provider, not in the browser and not in the Worker.

- [ ] **Step 2: Add required env design**

Document `CLOUDFLARE_AI_GATEWAY_URL` as the new optional container env.

- [ ] **Step 3: Add backend change note**

Document that planner model base URL must be configurable through env instead of hardcoded provider default.

- [ ] **Step 4: Commit**

```bash
git add DEPLOYMENT.md docs/ops/cloudflare-hardening.md
git commit -m "docs(infra): define AI Gateway insertion path"
```

---

### Task 5: Deployment and rollback clarity

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Document exact deploy order**

Current order:

1. build frontend
2. apply Supabase migrations
3. `wrangler deploy`

- [ ] **Step 2: Add rollback section**

Rollback paths:

- revert main and re-run deploy workflow
- restore previous worker/container via Wrangler deployment history if needed
- disable WAF changes separately from app rollback

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml DEPLOYMENT.md
git commit -m "docs(infra): add deploy and rollback sequence"
```

---

### Task 6: Verification

- [ ] **Step 1: Validate docs against live config**

Cross-check:

- `wrangler.toml`
- `worker/worker.js`
- `.github/workflows/ci.yml`

- [ ] **Step 2: Commit verification note**

```bash
git commit --allow-empty -m "docs(infra): verify Cloudflare hardening plan against current config"
```
