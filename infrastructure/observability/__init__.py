"""Observability infrastructure for tracing and metrics.

This module provides OpenTelemetry integration for:
- Distributed tracing with spans
- Metrics collection
- Configurable exporters

Usage:
    from infrastructure.observability import get_tracer, setup_tracing

    # Initialize tracing at startup
    setup_tracing(service_name="my-service")

    # Get a tracer for your module
    tracer = get_tracer(__name__)

    # Create spans
    with tracer.start_as_current_span("operation") as span:
        span.set_attribute("key", "value")
        # do work
"""

from infrastructure.observability.metrics import get_meter, setup_metrics
from infrastructure.observability.tracing import get_tracer, setup_tracing

__all__ = [
    "get_tracer",
    "setup_tracing",
    "get_meter",
    "setup_metrics",
]
