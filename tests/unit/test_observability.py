"""Unit tests for infrastructure observability module."""

from infrastructure.observability import get_meter, get_tracer


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
        histogram.record(100, {"operation": "test"})
