"""Logging configuration using structlog."""

import logging
import sys
from typing import Any, Dict, Optional

import structlog
from rich.console import Console
from rich.logging import RichHandler

from config import get_settings

# Rich console for pretty printing
console = Console()


def setup_logging(log_level: Optional[str] = None) -> None:
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
            )
        ]
    )

    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.CallsiteParameterAdder(
                parameters=[
                    structlog.processors.CallsiteParameter.FILENAME,
                    structlog.processors.CallsiteParameter.LINENO,
                    structlog.processors.CallsiteParameter.FUNC_NAME,
                ]
            ) if settings.debug else structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer() if settings.is_development
            else structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


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
        self.token: Optional[Any] = None

    def __enter__(self) -> structlog.BoundLogger:
        """Enter context and bind values."""
        self.token = structlog.contextvars.bind_contextvars(**self.context)
        return self.logger

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit context and unbind values."""
        if self.token:
            structlog.contextvars.unbind_contextvars(self.token)