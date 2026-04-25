"""Eval-specific fixtures — imports testcontainer DB from conftest_db.

Eval tests need real API keys (not mock settings) to call LLM providers.
The setup_test_environment fixture from the parent conftest is overridden
here to load real settings from .env instead of mock settings.

The ``real_db`` fixture is defined in ``conftest_db`` (shared with integration tests).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from dotenv import load_dotenv

pytest_plugins = ("backend.tests.conftest_db",)

# Load real .env so eval tests have real API keys
load_dotenv(Path(__file__).parents[3] / ".env")


@pytest.fixture(autouse=True)
def setup_test_environment():
    """Override parent conftest's mock settings — eval needs real API keys."""
    yield
