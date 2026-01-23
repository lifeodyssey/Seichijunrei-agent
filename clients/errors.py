"""Infrastructure/client errors.

These errors represent failures talking to external services (HTTP, SDKs, etc.).
They intentionally live outside the domain layer.
"""


class APIError(Exception):
    """Raised when an external API call fails."""
