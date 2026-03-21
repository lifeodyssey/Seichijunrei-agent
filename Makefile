# Seichijunrei Agent - Makefile

.PHONY: help install dev serve test test-all test-cov test-integration lint format check clean build

UV_CACHE_DIR ?= $(CURDIR)/.uv_cache
export UV_CACHE_DIR

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

serve:
	uv run seichijunrei-api

test:
	uv run pytest tests/unit/ -v

test-all:
	uv run pytest tests/ -v

test-cov:
	uv run pytest tests/unit/ -v --cov --cov-report=html --cov-report=term-missing

test-integration:
	uv run pytest tests/integration/ -v -m integration

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
