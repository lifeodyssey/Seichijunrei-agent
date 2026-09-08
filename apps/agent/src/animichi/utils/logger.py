"""Logging configuration using structlog."""

from typing import cast

import structlog
from structlog.typing import FilteringBoundLogger, Processor

# Mirrors structlog's built-in default chain
# (`structlog._config._BUILTIN_DEFAULT_PROCESSORS`) with three changes.
# `format_exc_info` renders `exc_info=` with `traceback.format_exception` and
# `JSONRenderer` emits one machine-readable line for the container's stdout and
# for Logfire, replacing the trailing `ConsoleRenderer` — which instead hands
# every frame to rich, which re-reads and syntax-highlights that frame's source
# file and pretty-prints its locals: 91 s and 28 MB of output for a single
# pydantic-ai agent-run error (issue #1502). `TimeStamper` also moves from the
# built-in local-time `"%Y-%m-%d %H:%M:%S"` to ISO-8601 UTC, because a JSON log
# line is read by machines in another timezone, not by the dev who printed it.
_PROCESSORS: tuple[Processor, ...] = (
    structlog.contextvars.merge_contextvars,
    structlog.processors.add_log_level,
    structlog.processors.StackInfoRenderer(),
    structlog.dev.set_exc_info,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.format_exc_info,
    structlog.processors.JSONRenderer(),
)


def configure_structlog() -> None:
    """Install the process-wide processor chain, once per process.

    Called from the FastAPI app factory (the container's process start) and
    from the test-session conftest. Later calls are no-ops so that neither a
    second `create_fastapi_app()` nor `structlog.testing.capture_logs` has its
    configuration clobbered.
    """
    if structlog.is_configured():
        return
    structlog.configure(processors=list(_PROCESSORS))


def get_logger(name: str, **kwargs: object) -> FilteringBoundLogger:
    """
    Get a structured logger instance.

    Args:
        name: Logger name (usually __name__)
        **kwargs: Additional context to bind to logger

    Returns:
        Configured structlog BoundLogger
    """
    logger = structlog.get_logger(name)

    if kwargs:
        logger = logger.bind(**kwargs)

    return cast(FilteringBoundLogger, logger)
