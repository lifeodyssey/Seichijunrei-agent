"""OpenTelemetry exporter configuration.

Provides factory functions for creating span and metric exporters.
"""

from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)


def create_span_exporter(exporter_type: str, **kwargs: object) -> Any | None:
    """Create a span exporter based on type."""
    if exporter_type == "console":
        return _create_console_span_exporter()
    elif exporter_type == "otlp":
        return _create_otlp_span_exporter(**kwargs)
    elif exporter_type == "jaeger":
        return _create_jaeger_span_exporter(**kwargs)
    else:
        logger.warning(f"Unknown span exporter type: {exporter_type}")
        return None


def create_metric_exporter(exporter_type: str, **kwargs: object) -> Any | None:
    """Create a metric exporter based on type."""
    if exporter_type == "console":
        return _create_console_metric_exporter()
    elif exporter_type == "otlp":
        return _create_otlp_metric_exporter(**kwargs)
    else:
        logger.warning(f"Unknown metric exporter type: {exporter_type}")
        return None


def _create_console_span_exporter() -> Any | None:
    """Create a console span exporter for development."""
    try:
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter

        return ConsoleSpanExporter()
    except ImportError:
        logger.warning("Console span exporter not available")
        return None


def _create_otlp_span_exporter(**kwargs: object) -> Any | None:
    """Create an OTLP span exporter."""
    try:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )

        endpoint = kwargs.get("endpoint", "localhost:4317")
        return OTLPSpanExporter(endpoint=str(endpoint))
    except ImportError:
        logger.warning(
            "OTLP exporter not available. "
            "Install with: pip install opentelemetry-exporter-otlp"
        )
        return None


def _create_jaeger_span_exporter(**kwargs: object) -> Any | None:
    """Create a Jaeger span exporter."""
    try:
        from opentelemetry.exporter.jaeger.thrift import JaegerExporter

        return JaegerExporter(
            agent_host_name=str(kwargs.get("host", "localhost")),
            agent_port=int(kwargs.get("port", 6831)),
        )
    except ImportError:
        logger.warning(
            "Jaeger exporter not available. "
            "Install with: pip install opentelemetry-exporter-jaeger"
        )
        return None


def _create_console_metric_exporter() -> Any | None:
    """Create a console metric exporter for development."""
    try:
        from opentelemetry.sdk.metrics.export import ConsoleMetricExporter

        return ConsoleMetricExporter()
    except ImportError:
        logger.warning("Console metric exporter not available")
        return None


def _create_otlp_metric_exporter(**kwargs: object) -> Any | None:
    """Create an OTLP metric exporter."""
    try:
        from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import (
            OTLPMetricExporter,
        )

        endpoint = kwargs.get("endpoint", "localhost:4317")
        return OTLPMetricExporter(endpoint=str(endpoint))
    except ImportError:
        logger.warning(
            "OTLP metric exporter not available. "
            "Install with: pip install opentelemetry-exporter-otlp"
        )
        return None
