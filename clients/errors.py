"""Infrastructure/client errors.

These errors represent failures talking to external services (HTTP, SDKs, etc.).
They intentionally live outside the domain layer.
"""


class APIError(Exception):
    """Raised when an external API call fails.

    The error_code can be used by gateways to translate into specific
    application/domain errors.
    """

    def __init__(self, message: str, *, error_code: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code


class NotFoundError(APIError):
    """Raised when a requested resource is not found."""

    def __init__(self, message: str, *, resource_type: str = "resource") -> None:
        super().__init__(message, error_code=f"{resource_type}_not_found")
        self.resource_type = resource_type


class ValidationError(APIError):
    """Raised when input validation fails at the API level."""

    def __init__(self, message: str) -> None:
        super().__init__(message, error_code="validation_error")
