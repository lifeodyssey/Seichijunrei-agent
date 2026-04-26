"""Typed handler result — replaces raw dict returns across all handlers."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class HandlerResult:
    """Typed return value for all handler execute() functions.

    Replaces the raw ``{"tool": ..., "success": ..., "data": ..., "error": ...}``
    dict that every handler previously returned.
    """

    tool: str
    success: bool
    data: dict[str, object] = field(default_factory=dict)
    error: str | None = None

    @staticmethod
    def ok(tool: str, data: dict[str, object]) -> HandlerResult:
        """Shortcut for a successful result."""
        return HandlerResult(tool=tool, success=True, data=data)

    @staticmethod
    def fail(tool: str, error: str) -> HandlerResult:
        """Shortcut for a failed result."""
        return HandlerResult(tool=tool, success=False, error=error)
