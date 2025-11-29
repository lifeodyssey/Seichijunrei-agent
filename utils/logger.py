"""Logging configuration using structlog."""

import logging
import time
from typing import Any

import structlog
from rich.console import Console
from rich.logging import RichHandler

from config import get_settings

# Rich console for pretty printing
console = Console()


def setup_logging(log_level: str | None = None) -> None:
    """
    Configure structured logging for the application.

    Args:
        log_level: Override log level from settings
    """
    settings = get_settings()
    level = log_level or settings.log_level

    # Configure standard logging
    logging.basicConfig(
        level=level,
        format="%(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            RichHandler(
                console=console,
                rich_tracebacks=True,
                tracebacks_show_locals=settings.debug,
                show_time=True,
                show_level=True,
                show_path=settings.debug,
                markup=True,
            )
        ],
        force=True,  # Force reconfiguration even if already configured
    )

    # Configure third-party library logging
    _configure_third_party_logging(level, settings.debug)

    # Configure structlog
    processors = [
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    # Add callsite info in debug mode
    if settings.debug:
        processors.append(
            structlog.processors.CallsiteParameterAdder(
                parameters=[
                    structlog.processors.CallsiteParameter.FILENAME,
                    structlog.processors.CallsiteParameter.LINENO,
                    structlog.processors.CallsiteParameter.FUNC_NAME,
                ]
            )
        )

    # Add console renderer
    if settings.is_development:
        processors.append(
            structlog.dev.ConsoleRenderer(
                colors=True,
                exception_formatter=structlog.dev.rich_traceback,
            )
        )
    else:
        processors.append(structlog.processors.JSONRenderer())

    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Log configuration info
    root_logger = structlog.get_logger("logger")
    root_logger.info(
        "Logging configured",
        log_level=level,
        debug_mode=settings.debug,
        environment=settings.app_env,
    )


def _configure_third_party_logging(level: str, debug: bool) -> None:
    """
    Configure logging for third-party libraries.

    Args:
        level: Log level string (DEBUG, INFO, etc.)
        debug: Whether debug mode is enabled
    """
    # Set level for third-party libraries
    # In DEBUG mode, show more details; in production, suppress noise

    if debug and level == "DEBUG":
        # Show detailed HTTP requests in debug mode
        logging.getLogger("httpx").setLevel(logging.DEBUG)
        logging.getLogger("httpcore").setLevel(logging.DEBUG)
        logging.getLogger("google.auth").setLevel(logging.DEBUG)
        logging.getLogger("google.api_core").setLevel(logging.DEBUG)
    else:
        # Suppress verbose third-party logs in production
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("google.auth").setLevel(logging.INFO)
        logging.getLogger("google.api_core").setLevel(logging.INFO)

    # Always suppress very noisy libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)


def get_logger(name: str, **kwargs: Any) -> structlog.BoundLogger:
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

    return logger


class LogContext:
    """Context manager for temporary log context."""

    def __init__(self, logger: structlog.BoundLogger, **kwargs: Any):
        """Initialize with logger and context to add."""
        self.logger = logger
        self.context = kwargs
        self.token: Any | None = None

    def __enter__(self) -> structlog.BoundLogger:
        """Enter context and bind values."""
        self.token = structlog.contextvars.bind_contextvars(**self.context)
        return self.logger

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit context and unbind values."""
        if self.token:
            structlog.contextvars.unbind_contextvars(self.token)


class LogTimer:
    """Context manager for timing and logging operations."""

    def __init__(
        self, logger: structlog.BoundLogger, operation: str, **extra_context: Any
    ):
        """
        Initialize timer context.

        Args:
            logger: Logger instance to use
            operation: Name of the operation being timed
            **extra_context: Additional context to log
        """
        self.logger = logger
        self.operation = operation
        self.extra_context = extra_context
        self.start_time: float | None = None

    def __enter__(self) -> "LogTimer":
        """Start timing."""
        self.start_time = time.time()
        self.logger.debug(
            f"[START] {self.operation}", operation=self.operation, **self.extra_context
        )
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """End timing and log duration."""
        duration = time.time() - self.start_time if self.start_time else 0

        if exc_type is not None:
            # Operation failed
            self.logger.error(
                f"[FAILED] {self.operation}",
                operation=self.operation,
                duration_seconds=round(duration, 3),
                error=str(exc_val),
                **self.extra_context,
            )
        else:
            # Operation succeeded
            self.logger.info(
                f"[COMPLETE] {self.operation}",
                operation=self.operation,
                duration_seconds=round(duration, 3),
                **self.extra_context,
            )
