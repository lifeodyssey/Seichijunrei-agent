"""Application-level errors.

Use cases (and the infrastructure adapters implementing application ports)
should raise these errors so interface layers don't need to depend on
infrastructure-specific exceptions (HTTP, SDKs, etc.).

Error Hierarchy:
    ApplicationError (base)
    ├── InvalidInputError - validation failures
    ├── NotFoundError - resource not found
    ├── ExternalServiceError - external API failures
    │   ├── RateLimitError - rate limit exceeded
    │   └── TimeoutError - request timeout
    └── ConfigurationError - missing/invalid config
"""

from __future__ import annotations


class ApplicationError(Exception):
    """Base exception for application/use-case errors.

    All application-level errors inherit from this class, allowing
    interface layers to catch broad categories of errors.
    """

    error_code: str = "internal_error"

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        self.message = message
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> dict:
        """Convert error to dictionary for API responses."""
        return {
            "error_code": self.error_code,
            "message": self.message,
            "details": self.details,
        }


class InvalidInputError(ApplicationError):
    """Raised when a use case receives invalid input."""

    error_code: str = "invalid_input"

    def __init__(self, message: str, *, field: str | None = None) -> None:
        details = {"field": field} if field else {}
        super().__init__(message, details=details)


class NotFoundError(ApplicationError):
    """Raised when a requested resource is not found."""

    error_code: str = "not_found"

    def __init__(self, resource_type: str, identifier: str | int) -> None:
        self.resource_type = resource_type
        self.identifier = identifier
        super().__init__(
            f"{resource_type} not found: {identifier}",
            details={"resource_type": resource_type, "identifier": str(identifier)},
        )


class ExternalServiceError(ApplicationError):
    """Raised when calling an external service fails."""

    error_code: str = "external_service_error"

    def __init__(self, service: str, detail: str) -> None:
        self.service = service
        self.detail = detail
        super().__init__(f"{service}: {detail}", details={"service": service})


class RateLimitError(ExternalServiceError):
    """Raised when an external service rate limit is exceeded."""

    error_code: str = "rate_limited"

    def __init__(self, service: str, retry_after: int | None = None) -> None:
        self.retry_after = retry_after
        detail = "rate limit exceeded"
        if retry_after:
            detail += f", retry after {retry_after}s"
        super().__init__(service, detail)
        self.details["retry_after"] = retry_after


class ServiceTimeoutError(ExternalServiceError):
    """Raised when an external service request times out."""

    error_code: str = "timeout"

    def __init__(self, service: str, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        super().__init__(service, f"request timed out after {timeout_seconds}s")
        self.details["timeout_seconds"] = timeout_seconds


class ConfigurationError(ApplicationError):
    """Raised when required configuration is missing or invalid."""

    error_code: str = "configuration_error"

    def __init__(self, message: str, *, missing_keys: list[str] | None = None) -> None:
        details = {"missing_keys": missing_keys} if missing_keys else {}
        super().__init__(message, details=details)
