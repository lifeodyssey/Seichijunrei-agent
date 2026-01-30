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
    │   ├── ServiceTimeoutError - request timeout
    │   └── ServiceUnavailableError - service unavailable
    ├── ConfigurationError - missing/invalid config
    └── AuthenticationError - authentication failures
"""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    """Standardized error codes for application errors.

    These codes provide a stable API for error handling across
    interface layers (REST, gRPC, CLI, etc.).
    """

    # General errors
    INTERNAL_ERROR = "internal_error"
    UNKNOWN_ERROR = "unknown_error"

    # Input validation errors
    INVALID_INPUT = "invalid_input"
    MISSING_REQUIRED_FIELD = "missing_required_field"
    INVALID_FORMAT = "invalid_format"

    # Resource errors
    NOT_FOUND = "not_found"
    ALREADY_EXISTS = "already_exists"

    # External service errors
    EXTERNAL_SERVICE_ERROR = "external_service_error"
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    SERVICE_UNAVAILABLE = "service_unavailable"

    # Configuration errors
    CONFIGURATION_ERROR = "configuration_error"
    MISSING_CONFIG = "missing_config"

    # Authentication errors
    AUTHENTICATION_ERROR = "authentication_error"
    INVALID_CREDENTIALS = "invalid_credentials"


class ApplicationError(Exception):
    """Base exception for application/use-case errors.

    All application-level errors inherit from this class, allowing
    interface layers to catch broad categories of errors.
    """

    error_code: ErrorCode = ErrorCode.INTERNAL_ERROR

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        self.message = message
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> dict:
        """Convert error to dictionary for API responses."""
        return {
            "error_code": self.error_code.value,
            "message": self.message,
            "details": self.details,
        }


class InvalidInputError(ApplicationError):
    """Raised when a use case receives invalid input."""

    error_code: ErrorCode = ErrorCode.INVALID_INPUT

    def __init__(self, message: str, *, field: str | None = None) -> None:
        details = {"field": field} if field else {}
        super().__init__(message, details=details)


class NotFoundError(ApplicationError):
    """Raised when a requested resource is not found."""

    error_code: ErrorCode = ErrorCode.NOT_FOUND

    def __init__(self, resource_type: str, identifier: str | int) -> None:
        self.resource_type = resource_type
        self.identifier = identifier
        super().__init__(
            f"{resource_type} not found: {identifier}",
            details={"resource_type": resource_type, "identifier": str(identifier)},
        )


class ExternalServiceError(ApplicationError):
    """Raised when calling an external service fails."""

    error_code: ErrorCode = ErrorCode.EXTERNAL_SERVICE_ERROR

    def __init__(self, service: str, detail: str) -> None:
        self.service = service
        self.detail = detail
        super().__init__(f"{service}: {detail}", details={"service": service})


class RateLimitError(ExternalServiceError):
    """Raised when an external service rate limit is exceeded."""

    error_code: ErrorCode = ErrorCode.RATE_LIMITED

    def __init__(self, service: str, retry_after: int | None = None) -> None:
        self.retry_after = retry_after
        detail = "rate limit exceeded"
        if retry_after:
            detail += f", retry after {retry_after}s"
        super().__init__(service, detail)
        self.details["retry_after"] = retry_after


class ServiceTimeoutError(ExternalServiceError):
    """Raised when an external service request times out."""

    error_code: ErrorCode = ErrorCode.TIMEOUT

    def __init__(self, service: str, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        super().__init__(service, f"request timed out after {timeout_seconds}s")
        self.details["timeout_seconds"] = timeout_seconds


class ConfigurationError(ApplicationError):
    """Raised when required configuration is missing or invalid."""

    error_code: ErrorCode = ErrorCode.CONFIGURATION_ERROR

    def __init__(self, message: str, *, missing_keys: list[str] | None = None) -> None:
        details = {"missing_keys": missing_keys} if missing_keys else {}
        super().__init__(message, details=details)


class ServiceUnavailableError(ExternalServiceError):
    """Raised when an external service is temporarily unavailable."""

    error_code: ErrorCode = ErrorCode.SERVICE_UNAVAILABLE

    def __init__(self, service: str, reason: str | None = None) -> None:
        detail = "service unavailable"
        if reason:
            detail += f": {reason}"
        super().__init__(service, detail)


class AuthenticationError(ApplicationError):
    """Raised when authentication fails."""

    error_code: ErrorCode = ErrorCode.AUTHENTICATION_ERROR

    def __init__(self, message: str, *, service: str | None = None) -> None:
        details = {"service": service} if service else {}
        super().__init__(message, details=details)
