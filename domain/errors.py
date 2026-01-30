"""Domain-level errors.

These exceptions represent business/domain failures and are intentionally free of
HTTP/SDK-specific semantics.
"""


class DomainException(Exception):
    """Base exception for domain errors.

    Domain errors represent business rule violations and are intentionally
    free of HTTP/SDK-specific semantics.
    """

    domain_code: str = "domain_error"

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class InvalidStationError(DomainException):
    """Raised when station name cannot be resolved."""

    domain_code: str = "invalid_station"

    def __init__(self, station_name: str) -> None:
        self.station_name = station_name
        super().__init__(f"Station not found: {station_name}")


class NoBangumiFoundError(DomainException):
    """Raised when no bangumi found in the area."""

    domain_code: str = "no_bangumi_found"

    def __init__(self, location: str | None = None) -> None:
        self.location = location
        msg = "No bangumi found"
        if location:
            msg += f" near {location}"
        super().__init__(msg)


class TooManyPointsError(DomainException):
    """Raised when too many points for route optimization."""

    domain_code: str = "too_many_points"

    def __init__(self, count: int, max_allowed: int = 25) -> None:
        self.count = count
        self.max_allowed = max_allowed
        super().__init__(
            f"Too many points ({count}) for route optimization. Maximum: {max_allowed}"
        )
