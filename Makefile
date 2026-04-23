# Seichijunrei Agent - Makefile

.PHONY: help install dev serve test test-all test-cov test-integration test-eval lint format typecheck check clean build db-diff db-list db-pull db-push db-push-dry db-reset fe-lint fe-typecheck fe-test fe-test-cov fe-build fe-check check-all

UV_CACHE_DIR ?= $(CURDIR)/.uv_cache
export UV_CACHE_DIR
PYTHON ?= .venv/bin/python
PYTEST ?= $(PYTHON) -m pytest

help:
	@echo "Seichijunrei Agent - Available commands:"
	@echo ""
	@echo "Development:"
	@echo "  make install     Install production dependencies"
	@echo "  make dev         Install all dependencies (including dev)"
	@echo "  make serve       Run the HTTP runtime service"
	@echo ""
	@echo "Testing:"
	@echo "  make test        Run unit tests"
	@echo "  make test-all    Run stable automated tests (unit + integration)"
	@echo "  make test-cov    Run tests with coverage report"
	@echo "  make test-eval   Run model-backed evals"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint        Run linters (ruff)"
	@echo "  make format      Format code (ruff)"
	@echo "  make typecheck   Run mypy type checker"
	@echo "  make check       Run all checks (lint + typecheck + test)"
	@echo ""
	@echo "Database:"
	@echo "  make db-list     Show Supabase migration status"
	@echo "  make db-push-dry  Dry-run Supabase migrations"
	@echo "  make db-push     Apply Supabase migrations"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean       Remove build artifacts and caches"

install:
	uv sync --no-dev

dev:
	uv sync --extra dev

serve:
	uv run seichijunrei-api

test:
	$(PYTEST) backend/tests/unit/ -v

test-all:
	$(PYTEST) backend/tests/unit backend/tests/integration -v

test-cov:
	$(PYTEST) backend/tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

test-integration:
	$(PYTEST) backend/tests/integration/ -v --no-cov

test-eval:
	$(PYTEST) backend/tests/eval/ -v -m integration --no-cov

lint:
	uv run ruff check backend/
	uv run ruff format --check backend/

format:
	uv run ruff format backend/
	uv run ruff check --fix backend/

typecheck:
	uv run mypy backend/agents/ backend/interfaces/ backend/domain/ backend/infrastructure/ backend/clients/

check: lint typecheck test

# ── Frontend ──────────────────────────────────────────────────

fe-lint:
	cd frontend && npx eslint .

fe-typecheck:
	cd frontend && npx tsc --noEmit

fe-test:
	cd frontend && npx vitest run

fe-test-cov:
	cd frontend && npx vitest run --coverage

fe-build:
	cd frontend && npm run build

fe-check: fe-lint fe-typecheck fe-test

# ── Full check (backend + frontend) ──────────────────────────

check-all: check fe-check

clean:
	rm -rf __pycache__ .pytest_cache .coverage htmlcov coverage.xml
	rm -rf .ruff_cache .mypy_cache
	rm -rf dist build *.egg-info
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true

build:
	uv build

db-diff:
	supabase db diff -f $(NAME) --schema public

db-list:
	supabase migration list --db-url $$SUPABASE_DB_URL

db-pull:
	supabase db pull $(NAME) --schema public

db-push-dry:
	supabase db push --dry-run --db-url $$SUPABASE_DB_URL

db-push:
	supabase db push --db-url $$SUPABASE_DB_URL

db-reset:
	supabase db reset

setup: dev
	@echo ""
	@echo "Setup complete! Try: make test"
