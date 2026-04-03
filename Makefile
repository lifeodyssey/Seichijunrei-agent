# Seichijunrei Agent - Makefile

.PHONY: help install dev serve test test-all test-cov test-integration test-eval lint format check clean build db-diff db-list db-pull db-push db-push-dry db-reset

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
	@echo "  make format      Format code (black + ruff)"
	@echo "  make check       Run all checks (lint + test)"
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
	$(PYTEST) tests/unit/ -v

test-all:
	$(PYTEST) tests/unit tests/integration -v

test-cov:
	$(PYTEST) tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

test-integration:
	$(PYTEST) tests/integration/ -v --no-cov

test-eval:
	$(PYTEST) tests/eval/ -v -m integration --no-cov

lint:
	uv run ruff check .
	uv run black --check .

format:
	uv run black .
	uv run ruff check --fix .

check: lint test

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
