# Seichijunrei Bot - Makefile

.PHONY: help install dev test lint format check clean build a2a a2ui-web

UV_CACHE_DIR ?= $(CURDIR)/.uv_cache
export UV_CACHE_DIR

help:
	@echo "Seichijunrei Bot - Available commands:"
	@echo ""
	@echo "Development:"
	@echo "  make install     Install production dependencies"
	@echo "  make dev         Install all dependencies (including dev)"
	@echo "  make a2a         Run the A2A server (port 8080)"
	@echo "  make a2ui-web    Run the A2UI web interface"
	@echo ""
	@echo "Testing:"
	@echo "  make test        Run unit tests"
	@echo "  make test-all    Run all tests (unit + integration)"
	@echo "  make test-cov    Run tests with coverage report"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint        Run linters (ruff)"
	@echo "  make format      Format code (black + ruff)"
	@echo "  make check       Run all checks (lint + test)"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean       Remove build artifacts and caches"

install:
	uv sync --no-dev

dev:
	uv sync --extra dev

test:
	uv run pytest tests/unit/ -v

test-all:
	uv run pytest tests/ -v

test-cov:
	uv run pytest tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

test-integration:
	uv run pytest tests/integration/ -v -m integration

a2ui-web:
	uv run python -m interfaces.a2ui_web.server

a2a:
	uv run uvicorn interfaces.a2a_server.main:app --port 8080 --reload

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

setup: dev
	@echo ""
	@echo "Setup complete! Try: make test"
