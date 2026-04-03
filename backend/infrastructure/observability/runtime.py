"""Runtime-specific tracing and metrics helpers."""

from __future__ import annotations

from backend.infrastructure.observability.metrics import (
    _NoOpCounter,
    _NoOpHistogram,
    get_meter,
)
from backend.infrastructure.observability.tracing import _NoOpTracer, get_tracer

_runtime_request_counter: _NoOpCounter | None = None
_runtime_request_duration: _NoOpHistogram | None = None
_http_request_counter: _NoOpCounter | None = None
_http_request_duration: _NoOpHistogram | None = None


def get_runtime_tracer() -> _NoOpTracer:
    """Return the tracer used for runtime calls."""
    return get_tracer("seichijunrei.runtime")


def get_http_tracer() -> _NoOpTracer:
    """Return the tracer used for HTTP request handling."""
    return get_tracer("seichijunrei.http")


def record_runtime_request(
    *,
    duration_ms: float,
    intent: str,
    status: str,
    transport: str,
) -> None:
    """Record runtime-level request metrics."""
    counter, histogram = _get_runtime_instruments()
    attributes = {
        "intent": intent,
        "status": status,
        "transport": transport,
    }
    counter.add(1, attributes)
    histogram.record(duration_ms, attributes)


def record_http_request(
    *,
    duration_ms: float,
    method: str,
    route: str,
    status_code: int,
) -> None:
    """Record HTTP-level request metrics."""
    counter, histogram = _get_http_instruments()
    attributes = {
        "http.method": method,
        "http.route": route,
        "http.status_code": status_code,
    }
    counter.add(1, attributes)
    histogram.record(duration_ms, attributes)


def reset_runtime_observability() -> None:
    """Reset cached instruments for tests and provider changes."""
    global _runtime_request_counter, _runtime_request_duration
    global _http_request_counter, _http_request_duration

    _runtime_request_counter = None
    _runtime_request_duration = None
    _http_request_counter = None
    _http_request_duration = None


def _get_runtime_instruments() -> tuple[_NoOpCounter, _NoOpHistogram]:
    global _runtime_request_counter, _runtime_request_duration

    if _runtime_request_counter is None or _runtime_request_duration is None:
        meter = get_meter("seichijunrei.runtime")
        _runtime_request_counter = meter.create_counter(
            "runtime_requests_total",
            description="Total number of runtime API calls.",
        )
        _runtime_request_duration = meter.create_histogram(
            "runtime_request_duration_ms",
            unit="ms",
            description="End-to-end runtime API duration in milliseconds.",
        )

    return _runtime_request_counter, _runtime_request_duration


def _get_http_instruments() -> tuple[_NoOpCounter, _NoOpHistogram]:
    global _http_request_counter, _http_request_duration

    if _http_request_counter is None or _http_request_duration is None:
        meter = get_meter("seichijunrei.http")
        _http_request_counter = meter.create_counter(
            "http_requests_total",
            description="Total number of HTTP requests handled by the service.",
        )
        _http_request_duration = meter.create_histogram(
            "http_request_duration_ms",
            unit="ms",
            description="HTTP request duration in milliseconds.",
        )

    return _http_request_counter, _http_request_duration
