"""Observability infrastructure for tracing and metrics.

This module provides OpenTelemetry integration for:
- Distributed tracing with spans
- Metrics collection
- Configurable exporters

Usage:
    from backend.infrastructure.observability import get_tracer, setup_tracing

    # Initialize tracing at startup
    setup_tracing(service_name="my-service")

    # Get a tracer for your module
    tracer = get_tracer(__name__)

    # Create spans
    with tracer.start_as_current_span("operation") as span:
        span.set_attribute("key", "value")
        # do work
"""

from backend.config.settings import Settings
from backend.infrastructure.observability.metrics import (
    get_meter,
    setup_metrics,
    shutdown_metrics,
)
from backend.infrastructure.observability.runtime import (
    get_http_tracer,
    get_runtime_tracer,
    record_http_request,
    record_runtime_request,
    reset_runtime_observability,
)
from backend.infrastructure.observability.tracing import (
    get_tracer,
    setup_tracing,
    shutdown_tracing,
)


def setup_observability(settings: Settings) -> None:
    """Initialize tracing and metrics from application settings."""
    if not settings.observability_enabled:
        return

    exporter_kwargs: dict[str, object] = {}
    if settings.observability_otlp_endpoint:
        exporter_kwargs["endpoint"] = settings.observability_otlp_endpoint

    setup_tracing(
        service_name=settings.observability_service_name,
        service_version=settings.observability_service_version,
        environment=settings.app_env,
        exporter_type=settings.observability_exporter_type,
        **exporter_kwargs,
    )
    setup_metrics(
        service_name=settings.observability_service_name,
        service_version=settings.observability_service_version,
        environment=settings.app_env,
        exporter_type=settings.observability_exporter_type,
        **exporter_kwargs,
    )
    reset_runtime_observability()


def shutdown_observability() -> None:
    """Flush and tear down tracing and metrics providers."""
    shutdown_tracing()
    shutdown_metrics()
    reset_runtime_observability()


__all__ = [
    "get_tracer",
    "setup_tracing",
    "shutdown_tracing",
    "get_meter",
    "setup_metrics",
    "shutdown_metrics",
    "setup_observability",
    "shutdown_observability",
    "get_runtime_tracer",
    "get_http_tracer",
    "record_runtime_request",
    "record_http_request",
    "reset_runtime_observability",
]
