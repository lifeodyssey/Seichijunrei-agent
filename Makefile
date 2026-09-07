# Animichi Agent - Makefile

.PHONY: help install dev dev-db dev-local serve test test-all test-cov test-integration test-eval test-eval-fullstack test-docs lint format typecheck typecheck-ty check clean build db-new db-list db-hash db-validate db-push db-push-dry seed-gazetteer test-worker e2e-setup e2e local-login dev-stop visual-canonicalize visual-check visual-check-self-test

UV_CACHE_DIR ?= $(CURDIR)/.uv_cache
export UV_CACHE_DIR
ATLAS_VERSION ?= 0.30.0
export ATLAS_VERSION
PYTHON ?= .venv/bin/python
PYTEST ?= $(PYTHON) -m pytest

help:
	@echo "Animichi Agent - Available commands:"
	@echo ""
	@echo "Development:"
	@echo "  make dev-db      Start agent-only Neon Local on postgres-wire port 5432"
	@echo "  make dev-local   Start everything (database + backend + web app)"
	@echo "  make dev-stop    Stop all local dev services"
	@echo "  make local-login Open the Neon Auth magic link in your browser (AUTH-2 #950)"
	@echo "  make install     Install production dependencies"
	@echo "  make dev         Install all dependencies (including dev)"
	@echo "  make serve       Run the HTTP runtime service only"
	@echo ""
	@echo "Testing:"
	@echo "  make test        Run unit tests"
	@echo "  make test-all    Run stable automated tests (unit + integration)"
	@echo "  make test-cov    Run tests with coverage report"
	@echo "  make test-eval   Run model-backed evals"
	@echo "  make test-eval-fullstack  Run thin full-stack eval (opt-in, not a PR gate)"
	@echo "  make test-docs   Run deterministic documentation guardrails"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint        Run linters (ruff)"
	@echo "  make format      Format code (ruff)"
	@echo "  make typecheck   Run mypy type checker"
	@echo "  make typecheck-ty Run the non-blocking ty baseline checker"
	@echo "  make check       Run all checks (lint + typecheck + test)"
	@echo ""
	@echo "Database:"
	@echo "  make db-new NAME=x  Create a timestamped Atlas migration"
	@echo "  make db-list        List checked-in Atlas migrations"
	@echo "  make db-hash        Regenerate migrations/neon/atlas.sum"
	@echo "  make db-validate    Validate Atlas checksums and SQL"
	@echo "  make db-push-dry    Dry-run Atlas migrations against Neon"
	@echo "  make db-push        Apply Atlas migrations against Neon"
	@echo "  make seed-gazetteer Load gazetteer seed (needs DATABASE_URL; schema first)"
	@echo "  db-diff/db-pull/db-reset are retired; use the Atlas targets above"
	@echo ""
	@echo "E2E Testing:"
	@echo "  make e2e-setup   Install E2E deps + Playwright browser (no Supabase; auth E2E is Neon, AUTH-2 #950)"
	@echo "  make e2e         Run all Playwright E2E tests"
	@echo "  make visual-check  Pixel mockup comparison (PAGE=landing MODE=day RATIO=0.01; no PAGE = all frames; JSON -> e2e/visual/report/summary.json)"
	@echo "  make visual-check-self-test  Atom contract check (all frames; needs docker + app up)"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean       Remove build artifacts and caches"

install:
	cd apps/agent && uv sync --no-dev

dev:
	cd apps/agent && uv sync --extra dev

serve:
	cd apps/agent && uv run animichi-api

test:
	cd apps/agent && $(PYTEST) src/animichi/tests/unit/ -v

test-all:
	cd apps/agent && $(PYTEST) src/animichi/tests/unit src/animichi/tests/integration -v

test-cov:
	cd apps/agent && $(PYTEST) src/animichi/tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

# The integration arm reports its own coverage under its own name: it is a
# separate Codecov flag (codecov.yml), and pytest-cov's `xml:<path>` replaces
# the addopts destination rather than adding to it, so the unit run's
# coverage.xml survives `make check`. The floor belongs to the unit arm alone —
# integration-only coverage is far below it, hence --cov-fail-under=0.
test-integration:
	cd apps/agent && $(PYTEST) src/animichi/tests/integration/ -v --cov-report=xml:coverage-integration.xml --cov-fail-under=0

test-eval:
	cd apps/agent && $(PYTHON) -m animichi.tests.eval.run_agent_eval
	cd apps/agent && $(PYTEST) src/animichi/tests/eval/test_translation.py -v -m integration --no-cov

test-eval-fullstack:
	cd apps/agent && EVAL_FULLSTACK=1 EVAL_MAX_CASES=$${EVAL_MAX_CASES:-50} $(PYTHON) -m animichi.tests.eval.run_agent_eval

test-docs:
	cd apps/agent && uv run pytest src/animichi/tests/unit/test_documentation_guardrails.py -q --no-cov

# test-docs is deliberately NOT a prerequisite here: the doc guardrails are
# ordinary unit tests, so `make test` and CI's `pytest src/animichi/tests/unit/` both
# already execute them. Keeping the dependency made `make check` run them twice.
# The target stays as a fast standalone loop while editing docs.
lint:
	# The whole package, not just src/ and scripts/: conftest.py, pyproject.toml
	# and tests/fixtures/ live outside both, and CI reaches ruff only through
	# this target now — a narrower path here is lint coverage silently dropped.
	cd apps/agent && uv run ruff check .
	cd apps/agent && uv run ruff format --check src/animichi/ scripts/
	# vulture runs in the affected agent CI gate; without it here a dead-code finding
	# reaches CI as a bare "exit code 3" after `make check` was green locally.
	cd apps/agent && uv run vulture src/animichi/ vulture_whitelist.py

format:
	cd apps/agent && uv run ruff format src/animichi/ scripts/
	cd apps/agent && uv run ruff check --fix src/animichi/ scripts/

typecheck:
	cd apps/agent && uv run mypy src/animichi/agents/ src/animichi/interfaces/ src/animichi/domain/ src/animichi/infrastructure/ src/animichi/clients/ src/animichi/tests/eval/

typecheck-ty:
	cd apps/agent && uv run ty check src/animichi/

check: lint typecheck test test-integration

# ── Edge worker ───────────────────────────────────────────────

test-worker:
	pnpm run test:worker

clean:
	rm -rf __pycache__ .pytest_cache .coverage htmlcov coverage.xml
	rm -rf .ruff_cache .mypy_cache
	rm -rf dist build *.egg-info
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true

build:
	cd apps/agent && uv build

ATLAS_MIGRATIONS := file://migrations/neon

db-new:
	@test -n "$(NAME)" || (echo "NAME is required (for example: make db-new NAME=add_routes_index)" >&2; exit 1)
	atlas migrate new "$(NAME)" --dir $(ATLAS_MIGRATIONS)

db-list:
	atlas migrate ls --dir $(ATLAS_MIGRATIONS)

db-hash:
	atlas migrate hash --dir $(ATLAS_MIGRATIONS)

db-validate:
	atlas migrate validate --dir $(ATLAS_MIGRATIONS)

db-push-dry:
	@: "$${NEON_DATABASE_URL:?NEON_DATABASE_URL is required}"
	atlas migrate apply --dry-run --dir $(ATLAS_MIGRATIONS) --url "$${NEON_DATABASE_URL}" --revisions-schema public

db-push:
	@: "$${NEON_DATABASE_URL:?NEON_DATABASE_URL is required}"
	atlas migrate apply --dir $(ATLAS_MIGRATIONS) --url "$${NEON_DATABASE_URL}" --revisions-schema public

seed-gazetteer:
	@: "$${DATABASE_URL:?DATABASE_URL is required}"
	scripts/seed-gazetteer.sh

# ── Local Dev (one-command startup) ──────────────────────────

# Set NEON_DEV_BRANCH_ID for persistent mode. Leave it unset and set the
# verified NEON_TEST_BASE_BRANCH_ID for an ephemeral child deleted on stop.
dev-db:
	@: "$${NEON_API_KEY:?NEON_API_KEY is required}"
	@: "$${NEON_PROJECT_ID:?NEON_PROJECT_ID is required}"
	@branch_env="PARENT_BRANCH_ID=$${NEON_TEST_BASE_BRANCH_ID:-}"; delete_branch=true; \
	if [ -n "$${NEON_DEV_BRANCH_ID:-}" ]; then \
		branch_env="BRANCH_ID=$$NEON_DEV_BRANCH_ID"; delete_branch=false; \
	fi; \
	if [ -z "$${branch_env#*=}" ]; then \
		echo "Set NEON_TEST_BASE_BRANCH_ID, or NEON_DEV_BRANCH_ID for persistent mode" >&2; \
		exit 1; \
	fi; \
	echo "Agent DSN: postgresql://neon:npg@localhost:5432/neondb?sslmode=require"; \
	docker run --rm --name animichi-neon-local -p 5432:5432 \
		-e NEON_API_KEY -e NEON_PROJECT_ID -e "$$branch_env" \
		-e DELETE_BRANCH="$$delete_branch" neondatabase/neon_local:latest

dev-local:
	@echo "=== Animichi Local Dev ==="
	@# 0. Kill stale processes from previous runs
	@-lsof -ti :8080 | xargs kill 2>/dev/null; true
	@-lsof -ti :3000 | xargs kill 2>/dev/null; true
	@# 1. Database — the backend's local Postgres, independent of auth E2E (AUTH-2
	@#    #950): apps/web login is Neon Auth. Most of the Playwright suite stubs
	@#    every transport, except e2e/web-neon-login.spec.ts, which drives the real
	@#    Neon Auth origin (live, self-skipping without QA creds). The local
	@#    Postgres is Neon Local via `make dev-db`.
	@#    If the supabase CLI is present, it is also accepted as a legacy way to
	@#    bring up a local Postgres for the backend (equal to make dev-db) — but it
	@#    is never an auth plane. Otherwise the backend needs a Neon DB (make
	@#    dev-db) or a .env DSN.
	@-if command -v supabase >/dev/null 2>&1; then \
		if supabase status >/dev/null 2>&1; then \
			echo "Local Postgres already up via supabase — using it as the local DB (Neon Local: make dev-db)"; \
		else \
			echo "Starting a local Postgres via supabase CLI (backed by Neon Local, make dev-db)..."; \
			supabase start --exclude vector,analytics --ignore-health-check; \
		fi; \
	else \
		echo "⚠ supabase CLI not found — start the backend's local Postgres with make dev-db"; \
	fi
	@# 2. Wait for DB to be ready
	@-if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^supabase_db_seichijunrei-agent$$'; then \
		echo "Waiting for database..."; \
		for i in $$(seq 1 30); do docker exec supabase_db_seichijunrei-agent psql -U postgres -c "SELECT 1" >/dev/null 2>&1 && break || sleep 1; done; \
		echo "✓ Database ready"; \
	fi
	@# 3. Seed data if bangumi table is empty
	@-if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^supabase_db_seichijunrei-agent$$'; then \
		COUNT=$$(docker exec supabase_db_seichijunrei-agent psql -U postgres -d postgres -tAc "SELECT count(*) FROM bangumi" 2>/dev/null || echo "0"); \
		if [ "$$COUNT" = "0" ]; then \
			docker exec -i supabase_db_seichijunrei-agent psql -U postgres -d postgres < apps/agent/src/animichi/tests/fixtures/seed.sql; \
			echo "✓ Seed data applied"; \
		else \
			echo "✓ Data exists ($$COUNT bangumi)"; \
		fi; \
	fi
	@# 4. Start backend with .env (background, daemonized)
	@env $$(grep -v '^\#' .env | grep -v '^$$' | xargs) bash -c 'cd apps/agent && uv run uvicorn animichi.interfaces.fastapi_service:app --host 0.0.0.0 --port 8080' > /tmp/animichi-backend.log 2>&1 & echo $$! > /tmp/animichi-backend.pid
	@# 6. Wait for backend health
	@echo "Waiting for backend..."
	@for i in $$(seq 1 60); do curl -s http://localhost:8080/healthz >/dev/null 2>&1 && break || sleep 2; done
	@curl -s http://localhost:8080/healthz >/dev/null 2>&1 && echo "✓ Backend ready on :8080" || (echo "✗ Backend failed — check /tmp/animichi-backend.log" && exit 1)
	@# 7. Start the web app on :3000 (matching config.toml site_url)
	@pnpm --filter web dev > /tmp/animichi-web.log 2>&1 & echo $$! > /tmp/animichi-web.pid
	@sleep 3
	@echo "✓ Web app starting on :3000"
	@echo ""
	@echo "=== Ready ==="
	@echo "  Web app:   http://localhost:3000"
	@echo "  Backend:   http://localhost:8080/healthz"
	@echo "  Login:     make local-login   (Neon Auth magic link; needs VITE_NEON_AUTH_BASE_URL + NEON_DATABASE_URL)"
	@echo "  Stop:      make dev-stop"

dev-stop:
	@echo "Stopping local dev services..."
	@-test -f /tmp/animichi-backend.pid && kill $$(cat /tmp/animichi-backend.pid) 2>/dev/null && rm /tmp/animichi-backend.pid && echo "✓ Backend stopped" || true
	@-test -f /tmp/animichi-web.pid && kill $$(cat /tmp/animichi-web.pid) 2>/dev/null && rm /tmp/animichi-web.pid && echo "✓ Web app stopped" || true
	@-lsof -ti :8080 | xargs kill 2>/dev/null; true
	@-lsof -ti :3000 | xargs kill 2>/dev/null; true
	@echo "Done. (The database stays up — stop Neon Local with: docker stop animichi-neon-local ; or 'supabase stop' if the legacy supabase fallback was used)"

# ── E2E Testing ──────────────────────────────────────────────

e2e-setup:
	bash scripts/e2e-setup.sh

e2e:
	cd e2e && npx playwright test

local-login:
	bash scripts/local-login.sh

# ── Visual comparison (S0-v2 C3 + F2 task atom) ─────────────
# User-facing params: PAGE (frame key or partial key; empty = all frames),
# MODE (day|night), RATIO (pixel budget, from config — default 0.01).
# Result contract: e2e/visual/report/summary.json is the single authoritative
# verdict — exitCode 0 pass / 1 visual diff / 2 environment or invocation,
# plus per-frame ratio/pass and failedFrames. Through make, GNU make remaps
# any recipe failure to its own exit 2 (still nonzero); read summary.json to
# distinguish 1 from 2. Canonicalize runs inside scripts/visual-check.sh; the
# runner clears report/ once before the frame loop (never the host shell —
# bind-mount races; never per frame, or frame N+1 deletes frame N's report).

PAGE ?=
MODE ?= day
RATIO ?= 0.01
VISUAL_PLAYWRIGHT_IMAGE ?= mcr.microsoft.com/playwright:v1.62.0-noble

visual-canonicalize:
	@echo "visual-canonicalize: regenerating frozen canonical mockups"
	node --experimental-strip-types e2e/visual/canonicalize-cli.ts --out e2e/visual/canonical --fonts apps/web/src/styles/fonts.css

visual-check:
	@PAGE="$(PAGE)" MODE="$(MODE)" RATIO="$(RATIO)" \
	 VISUAL_PLAYWRIGHT_IMAGE="$(VISUAL_PLAYWRIGHT_IMAGE)" E2E_WEB_BASE_URL="$(E2E_WEB_BASE_URL)" \
	 bash scripts/visual-check.sh; exit $$?

# Self-test of the atom contract at the shell boundary: runs the atom WITHOUT
# PAGE (every frame), then asserts every frame has a report, every verdict is
# pass, and summary.exitCode is 0. The budget is loose by design (0.9999) —
# this checks the contract, not frame convergence (C4). Needs a reachable app
# (E2E_WEB_BASE_URL) and docker; fails closed when either is missing.
visual-check-self-test:
	@E2E_WEB_BASE_URL="$(E2E_WEB_BASE_URL)" bash e2e/visual/check-multiframe.sh

# ── Setup ────────────────────────────────────────────────────

setup: dev
	@echo ""
	@echo "Setup complete! Try: make test"
