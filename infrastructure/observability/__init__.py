"""Observability infrastructure for tracing and metrics.

This module provides OpenTelemetry integration for:
- Distributed tracing with spans
- Metrics collection
- Configurable exporters
"""

from infrastructure.observability.metrics import get_meter, setup_metrics
from infrastructure.observability.tracing import get_tracer, setup_tracing

__all__ = [
    "get_tracer",
    "setup_tracing",
    "get_meter",
    "setup_metrics",
]
