"""Standardized tool result types for ADK tools.

This module provides a consistent error contract for all ADK tools,
ensuring predictable responses that don't crash the ADK execution pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class ToolResult(Generic[T]):
    """Standardized result type for ADK tools.

    Attributes:
        success: Whether the tool execution succeeded
        data: The result data (None if failed)
        error: Error message (None if succeeded)
        error_code: Machine-readable error code for programmatic handling
        metadata: Additional context about the execution
    """

    success: bool
    data: T | None = None
    error: str | None = None
    error_code: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for ADK tool response."""
        result: dict[str, Any] = {
            "success": self.success,
            "error": self.error,
        }
        if self.data is not None:
            if isinstance(self.data, dict):
                result.update(self.data)
            else:
                result["data"] = self.data
        if self.error_code:
            result["error_code"] = self.error_code
        if self.metadata:
            result["metadata"] = self.metadata
        return result


def success_result(data: T, **metadata: Any) -> ToolResult[T]:
    """Create a successful tool result.

    Args:
        data: The result data
        **metadata: Additional metadata to include

    Returns:
        ToolResult indicating success
    """
    return ToolResult(success=True, data=data, metadata=metadata)


def error_result(
    error: str | Exception,
    *,
    error_code: str | None = None,
    **metadata: Any,
) -> ToolResult[None]:
    """Create a failed tool result.

    Args:
        error: Error message or exception
        error_code: Machine-readable error code
        **metadata: Additional metadata to include

    Returns:
        ToolResult indicating failure
    """
    error_msg = str(error) if isinstance(error, Exception) else error
    return ToolResult(
        success=False,
        data=None,
        error=error_msg,
        error_code=error_code,
        metadata=metadata,
    )


# Common error codes
class ErrorCodes:
    """Standard error codes for tool failures."""

    # External service errors
    EXTERNAL_SERVICE_ERROR = "external_service_error"
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    NOT_FOUND = "not_found"

    # Validation errors
    INVALID_INPUT = "invalid_input"
    MISSING_REQUIRED_FIELD = "missing_required_field"

    # Internal errors
    INTERNAL_ERROR = "internal_error"
    CONFIGURATION_ERROR = "configuration_error"
