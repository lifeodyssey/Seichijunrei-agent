"""Unit tests for infrastructure observability module."""

from unittest.mock import patch

from backend.config.settings import Settings
from backend.infrastructure.observability import (
    get_meter,
    get_tracer,
    setup_observability,
    shutdown_observability,
)


class TestTracing:
    """Tests for tracing utilities."""

    def test_get_tracer_returns_tracer(self):
        """Test that get_tracer returns a tracer instance."""
        tracer = get_tracer(__name__)
        assert tracer is not None

    def test_tracer_can_create_span(self):
        """Test that tracer can create spans."""
        tracer = get_tracer(__name__)

        with tracer.start_as_current_span("test-span") as span:
            assert span is not None

    def test_span_can_set_attributes(self):
        """Test that spans can set attributes."""
        tracer = get_tracer(__name__)

        with tracer.start_as_current_span("test-span") as span:
            # Should not raise
            span.set_attribute("session_id", "test-123")
            span.set_attribute("skill_id", "search")


class TestMetrics:
    """Tests for metrics utilities."""

    def test_get_meter_returns_meter(self):
        """Test that get_meter returns a meter instance."""
        meter = get_meter(__name__)
        assert meter is not None

    def test_meter_can_create_counter(self):
        """Test that meter can create counters."""
        meter = get_meter(__name__)
        counter = meter.create_counter("test_counter")
        assert counter is not None

    def test_counter_can_add(self):
        """Test that counter can add values."""
        meter = get_meter(__name__)
        counter = meter.create_counter("test_counter")
        # Should not raise
        counter.add(1, {"key": "value"})

    def test_meter_can_create_histogram(self):
        """Test that meter can create histograms."""
        meter = get_meter(__name__)
        histogram = meter.create_histogram("test_histogram")
        assert histogram is not None

    def test_histogram_can_record(self):
        """Test that histogram can record values."""
        meter = get_meter(__name__)
        histogram = meter.create_histogram("test_histogram")
        # Should not raise
        histogram.record(100, {"operation": "test"})


class TestObservabilityLifecycle:
    """Tests for combined observability setup and shutdown helpers."""

    def test_setup_observability_configures_tracing_and_metrics(self):
        settings = Settings(
            observability_enabled=True,
            observability_exporter_type="otlp",
            observability_otlp_endpoint="http://otel:4317",
        )

        with (
            patch(
                "backend.infrastructure.observability.setup_tracing"
            ) as setup_tracing_mock,
            patch(
                "backend.infrastructure.observability.setup_metrics"
            ) as setup_metrics_mock,
            patch(
                "backend.infrastructure.observability.reset_runtime_observability"
            ) as reset_mock,
        ):
            setup_observability(settings)

        setup_tracing_mock.assert_called_once()
        setup_metrics_mock.assert_called_once()
        assert setup_tracing_mock.call_args.kwargs["endpoint"] == "http://otel:4317"
        assert setup_metrics_mock.call_args.kwargs["endpoint"] == "http://otel:4317"
        reset_mock.assert_called_once()

    def test_shutdown_observability_flushes_all_providers(self):
        with (
            patch(
                "backend.infrastructure.observability.shutdown_tracing"
            ) as shutdown_tracing_mock,
            patch(
                "backend.infrastructure.observability.shutdown_metrics"
            ) as shutdown_metrics_mock,
            patch(
                "backend.infrastructure.observability.reset_runtime_observability"
            ) as reset_mock,
        ):
            shutdown_observability()

        shutdown_tracing_mock.assert_called_once()
        shutdown_metrics_mock.assert_called_once()
        reset_mock.assert_called_once()
