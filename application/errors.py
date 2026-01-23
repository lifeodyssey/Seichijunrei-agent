"""Application-level errors.

Use cases (and the infrastructure adapters implementing application ports)
should raise these errors so interface layers don't need to depend on
infrastructure-specific exceptions (HTTP, SDKs, etc.).
"""

from __future__ import annotations


class ApplicationError(Exception):
    """Base exception for application/use-case errors."""


class InvalidInputError(ApplicationError):
    """Raised when a use case receives invalid input."""


class ExternalServiceError(ApplicationError):
    """Raised when calling an external service fails."""

    def __init__(self, service: str, detail: str) -> None:
        self.service = service
        self.detail = detail
        super().__init__(f"{service}: {detail}")
