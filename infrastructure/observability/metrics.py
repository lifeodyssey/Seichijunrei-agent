"""OpenTelemetry metrics setup and utilities.

Provides meter provider configuration and metrics collection utilities.
"""

from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)

# Global meter provider reference
_meter_provider: Any = None
_initialized: bool = False


def setup_metrics(
    service_name: str = "seichijunrei",
    service_version: str = "0.1.0",
    environment: str = "development",
    exporter_type: str = "console",
    **exporter_kwargs: object,
) -> None:
    """Initialize the OpenTelemetry meter provider.

    Args:
        service_name: Name of the service for metrics.
        service_version: Version of the service.
        environment: Deployment environment.
        exporter_type: Type of exporter ("console", "otlp", "none").
        **exporter_kwargs: Additional arguments for the exporter.
    """
    global _meter_provider, _initialized

    if _initialized:
        logger.warning("Metrics already initialized, skipping")
        return

    try:
        from opentelemetry import metrics
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.resources import Resource

        from infrastructure.observability.exporters import create_metric_exporter
    except ImportError as e:
        logger.warning(
            "OpenTelemetry not available, metrics disabled",
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

    # Create metric reader with exporter
    readers = []
    if exporter_type != "none":
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader

        exporter = create_metric_exporter(exporter_type, **exporter_kwargs)
        if exporter is not None:
            readers.append(PeriodicExportingMetricReader(exporter))

    # Create and configure meter provider
    _meter_provider = MeterProvider(
        resource=resource,
        metric_readers=readers,
    )

    # Set as global meter provider
    metrics.set_meter_provider(_meter_provider)
    _initialized = True

    logger.info(
        "Metrics initialized",
        service_name=service_name,
        exporter_type=exporter_type,
    )


def get_meter(name: str) -> Any:
    """Get a meter instance for the given module.

    Args:
        name: Module name (typically __name__).

    Returns:
        A meter instance for creating metrics.
    """
    try:
        from opentelemetry import metrics

        return metrics.get_meter(name)
    except ImportError:
        return _NoOpMeter()


def shutdown_metrics() -> None:
    """Shutdown the meter provider."""
    global _meter_provider, _initialized

    if _meter_provider is not None:
        _meter_provider.shutdown()
        _meter_provider = None
        _initialized = False
        logger.info("Metrics shutdown complete")


class _NoOpMeter:
    """No-op meter for when OpenTelemetry is not available."""

    def create_counter(self, name: str, **kwargs: object) -> "_NoOpCounter":
        return _NoOpCounter()

    def create_histogram(self, name: str, **kwargs: object) -> "_NoOpHistogram":
        return _NoOpHistogram()

    def create_up_down_counter(self, name: str, **kwargs: object) -> "_NoOpCounter":
        return _NoOpCounter()


class _NoOpCounter:
    """No-op counter."""

    def add(
        self, amount: int | float, attributes: dict[str, Any] | None = None
    ) -> None:
        pass


class _NoOpHistogram:
    """No-op histogram."""

    def record(
        self, amount: int | float, attributes: dict[str, Any] | None = None
    ) -> None:
        pass
