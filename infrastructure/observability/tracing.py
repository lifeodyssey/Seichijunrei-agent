"""OpenTelemetry tracing setup and utilities.

Provides tracer provider configuration and span creation utilities.
"""

from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)

# Global tracer provider reference
_tracer_provider: Any = None
_initialized: bool = False


def setup_tracing(
    service_name: str = "seichijunrei",
    service_version: str = "0.1.0",
    environment: str = "development",
    exporter_type: str = "console",
    **exporter_kwargs: object,
) -> None:
    """Initialize the OpenTelemetry tracer provider.

    Args:
        service_name: Name of the service for tracing.
        service_version: Version of the service.
        environment: Deployment environment (development, staging, production).
        exporter_type: Type of exporter ("console", "otlp", "jaeger", "none").
        **exporter_kwargs: Additional arguments for the exporter.
    """
    global _tracer_provider, _initialized

    if _initialized:
        logger.warning("Tracing already initialized, skipping")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider

        from infrastructure.observability.exporters import create_span_exporter
    except ImportError as e:
        logger.warning(
            "OpenTelemetry not available, tracing disabled",
            error=str(e),
        )
        return

    # Create resource with service information
    resource = Resource.create(
        {
            "service.name": service_name,
            "service.version": service_version,
            "deployment.environment": environment,
        }
    )

    # Create and configure tracer provider
    _tracer_provider = TracerProvider(resource=resource)

    # Add span processor with exporter
    if exporter_type != "none":
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        exporter = create_span_exporter(exporter_type, **exporter_kwargs)
        if exporter is not None:
            _tracer_provider.add_span_processor(BatchSpanProcessor(exporter))

    # Set as global tracer provider
    trace.set_tracer_provider(_tracer_provider)
    _initialized = True

    logger.info(
        "Tracing initialized",
        service_name=service_name,
        exporter_type=exporter_type,
    )


def get_tracer(name: str) -> Any:
    """Get a tracer instance for the given module.

    Args:
        name: Module name (typically __name__).

    Returns:
        A tracer instance. Returns a no-op tracer if OpenTelemetry
        is not available or not initialized.
    """
    try:
        from opentelemetry import trace

        return trace.get_tracer(name)
    except ImportError:
        # Return a no-op tracer if OpenTelemetry is not available
        return _NoOpTracer()


def shutdown_tracing() -> None:
    """Shutdown the tracer provider and flush pending spans."""
    global _tracer_provider, _initialized

    if _tracer_provider is not None:
        _tracer_provider.shutdown()
        _tracer_provider = None
        _initialized = False
        logger.info("Tracing shutdown complete")


class _NoOpSpan:
    """No-op span for when tracing is disabled."""

    def set_attribute(self, key: str, value: Any) -> None:
        pass

    def set_attributes(self, attributes: dict[str, Any]) -> None:
        pass

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        pass

    def record_exception(self, exception: BaseException) -> None:
        pass

    def __enter__(self) -> "_NoOpSpan":
        return self

    def __exit__(self, *args: object) -> None:
        pass


class _NoOpTracer:
    """No-op tracer for when OpenTelemetry is not available."""

    def start_as_current_span(
        self,
        name: str,
        **kwargs: object,
    ) -> _NoOpSpan:
        return _NoOpSpan()

    def start_span(self, name: str, **kwargs: object) -> _NoOpSpan:
        return _NoOpSpan()
