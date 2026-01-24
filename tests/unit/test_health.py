"""Unit tests for health check module."""

import pytest

from health import (
    VERSION,
    _check_agents,
    _check_domain,
    _check_tools,
    health_check,
    readiness_check,
    startup_check,
)


class TestHealthCheck:
    """Tests for health_check function."""

    @pytest.mark.asyncio
    async def test_returns_healthy_status(self):
        """Should return healthy status."""
        result = await health_check()
        assert result["status"] == "healthy"

    @pytest.mark.asyncio
    async def test_includes_version(self):
        """Should include version info."""
        result = await health_check()
        assert result["version"] == VERSION

    @pytest.mark.asyncio
    async def test_includes_timestamp(self):
        """Should include timestamp."""
        result = await health_check()
        assert "timestamp" in result

    @pytest.mark.asyncio
    async def test_includes_components(self):
        """Should include component counts."""
        result = await health_check()
        assert "components" in result
        assert "adk_agents" in result["components"]
        assert "workflow_steps" in result["components"]
        assert "tools" in result["components"]


class TestCheckAgents:
    """Tests for _check_agents function."""

    @pytest.mark.asyncio
    async def test_returns_true_when_agents_available(self):
        """Should return True when agents can be imported."""
        result = await _check_agents()
        assert result is True


class TestCheckTools:
    """Tests for _check_tools function."""

    @pytest.mark.asyncio
    async def test_returns_true_when_tools_available(self):
        """Should return True when tools can be imported."""
        result = await _check_tools()
        assert result is True


class TestCheckDomain:
    """Tests for _check_domain function."""

    @pytest.mark.asyncio
    async def test_returns_true_when_domain_works(self):
        """Should return True when domain entities work."""
        result = await _check_domain()
        assert result is True


class TestReadinessCheck:
    """Tests for readiness_check function."""

    @pytest.mark.asyncio
    async def test_returns_ready_status(self):
        """Should return ready status when all checks pass."""
        result = await readiness_check()
        assert result["status"] == "ready"

    @pytest.mark.asyncio
    async def test_includes_services(self):
        """Should include service check results."""
        result = await readiness_check()
        assert "services" in result
        assert "agents" in result["services"]
        assert "tools" in result["services"]
        assert "domain" in result["services"]

    @pytest.mark.asyncio
    async def test_services_have_status(self):
        """Each service should have a status."""
        result = await readiness_check()
        for _service_name, service_info in result["services"].items():
            assert "status" in service_info
            assert "checked_at" in service_info


class TestStartupCheck:
    """Tests for startup_check function."""

    @pytest.mark.asyncio
    async def test_returns_startup_status(self):
        """Should return startup status."""
        result = await startup_check()
        assert "startup_status" in result

    @pytest.mark.asyncio
    async def test_includes_health_and_readiness(self):
        """Should include both health and readiness results."""
        result = await startup_check()
        assert "health" in result
        assert "readiness" in result

    @pytest.mark.asyncio
    async def test_ok_when_all_pass(self):
        """Should be ok when all checks pass."""
        result = await startup_check()
        assert result["startup_status"] == "ok"
