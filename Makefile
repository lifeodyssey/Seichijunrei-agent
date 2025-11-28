# Seichijunrei Bot - Makefile
# Convenience commands for development, testing, and deployment

.PHONY: help install dev test lint format check clean run deploy health

# Default target
help:
	@echo "Seichijunrei Bot - Available commands:"
	@echo ""
	@echo "Development:"
	@echo "  make install     Install production dependencies"
	@echo "  make dev         Install all dependencies (including dev)"
	@echo "  make run         Run the agent locally with ADK"
	@echo "  make web         Run the agent with ADK web interface"
	@echo ""
	@echo "Testing:"
	@echo "  make test        Run unit tests"
	@echo "  make test-all    Run all tests (unit + integration)"
	@echo "  make test-cov    Run tests with coverage report"
	@echo "  make health      Run health checks"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint        Run linters (ruff)"
	@echo "  make format      Format code (black + ruff)"
	@echo "  make check       Run all checks (lint + test)"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-staging    Deploy to staging environment"
	@echo "  make deploy-prod       Deploy to production environment"
	@echo "  make deploy-dry-run    Show deployment plan without executing"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean       Remove build artifacts and caches"

# Installation
install:
	uv sync --no-dev

dev:
	uv sync --dev
	uv run playwright install chromium

# Run locally
run:
	uv run adk run adk_agents/seichijunrei_bot

web:
	uv run adk web adk_agents

# Testing
test:
	uv run pytest tests/unit/ -v

test-all:
	uv run pytest tests/ -v

test-cov:
	uv run pytest tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

test-integration:
	uv run pytest tests/integration/ -v -m integration

# Health checks
health:
	uv run python health.py

# Code quality
lint:
	uv run ruff check .
	uv run black --check .

format:
	uv run black .
	uv run ruff check --fix .

check: lint test

# Deployment
deploy-staging:
	@if [ -z "$(GCP_PROJECT_ID)" ]; then \
		echo "Error: GCP_PROJECT_ID environment variable is required"; \
		exit 1; \
	fi
	uv run python deploy/deploy.py --project=$(GCP_PROJECT_ID) --env=staging

deploy-prod:
	@if [ -z "$(GCP_PROJECT_ID)" ]; then \
		echo "Error: GCP_PROJECT_ID environment variable is required"; \
		exit 1; \
	fi
	uv run python deploy/deploy.py --project=$(GCP_PROJECT_ID) --env=production

deploy-dry-run:
	@if [ -z "$(GCP_PROJECT_ID)" ]; then \
		echo "Error: GCP_PROJECT_ID environment variable is required"; \
		exit 1; \
	fi
	uv run python deploy/deploy.py --project=$(GCP_PROJECT_ID) --env=staging --dry-run

# Cleanup
clean:
	rm -rf __pycache__ .pytest_cache .coverage htmlcov coverage.xml
	rm -rf .ruff_cache .mypy_cache
	rm -rf dist build *.egg-info
	rm -rf output/maps/*.html output/pdfs/*.pdf
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true

# Build
build:
	uv build

# Quick start for new developers
setup: dev
	@echo ""
	@echo "Setup complete! Try these commands:"
	@echo "  make test    - Run tests"
	@echo "  make run     - Run the agent locally"
	@echo "  make web     - Run with web interface"
