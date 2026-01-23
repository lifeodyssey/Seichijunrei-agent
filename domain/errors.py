"""Domain-level errors.

These exceptions represent business/domain failures and are intentionally free of
HTTP/SDK-specific semantics.
"""


class DomainException(Exception):
    """Base exception for domain errors."""


class InvalidStationError(DomainException):
    """Raised when station name cannot be resolved."""


class NoBangumiFoundError(DomainException):
    """Raised when no bangumi found in the area."""


class TooManyPointsError(DomainException):
    """Raised when too many points for route optimization."""
