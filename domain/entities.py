"""
Domain entities for Seichijunrei Bot.
These are the core business objects used throughout the application.
"""

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

# === Value Objects ===


class Coordinates(BaseModel):
    """GPS coordinates (immutable value object)."""

    model_config = ConfigDict(frozen=True)  # Make immutable

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

    @field_validator("latitude")
    @classmethod
    def round_latitude(cls, v: float) -> float:
        return round(v, 6)  # Round to 6 decimal places

    @field_validator("longitude")
    @classmethod
    def round_longitude(cls, v: float) -> float:
        return round(v, 6)  # Round to 6 decimal places

    def to_tuple(self) -> tuple[float, float]:
        """Convert to tuple format (lat, lon)."""
        return (self.latitude, self.longitude)

    def to_string(self) -> str:
        """Convert to comma-separated string format."""
        return f"{self.latitude},{self.longitude}"

    def distance_to(self, other: "Coordinates") -> float:
        """
        Calculate distance to another coordinate in kilometers.
        Uses Haversine formula for great circle distance.
        """
        from math import atan2, cos, radians, sin, sqrt

        R = 6371  # Earth's radius in kilometers

        lat1, lon1 = radians(self.latitude), radians(self.longitude)
        lat2, lon2 = radians(other.latitude), radians(other.longitude)

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))

        return R * c


# === Entities ===


class Station(BaseModel):
    """Railway station entity."""

    name: str = Field(..., min_length=1)
    coordinates: Coordinates
    city: str | None = None
    prefecture: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return v.strip()


class Bangumi(BaseModel):
    """Anime series entity."""

    id: str = Field(..., min_length=1)
    title: str  # Original title (Japanese)
    cn_title: str  # Chinese title
    cover_url: HttpUrl  # Cover image URL
    points_count: int = Field(..., ge=0)
    distance_km: float | None = Field(None, ge=0)
    primary_color: str | None = None  # For map markers

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        return v.strip()

    def __hash__(self):
        return hash(self.id)


class Point(BaseModel):
    """Pilgrimage location entity."""

    id: str = Field(..., min_length=1)
    name: str  # Original name (Japanese)
    cn_name: str  # Chinese name
    coordinates: Coordinates
    bangumi_id: str
    bangumi_title: str
    episode: int = Field(..., ge=0)
    time_seconds: int = Field(..., ge=0)
    screenshot_url: HttpUrl
    address: str | None = None
    opening_hours: str | None = None
    admission_fee: str | None = None

    @property
    def time_formatted(self) -> str:
        """Format time as MM:SS."""
        minutes = self.time_seconds // 60
        seconds = self.time_seconds % 60
        return f"{minutes}:{seconds:02d}"

    def __hash__(self):
        return hash(self.id)


class TransportInfo(BaseModel):
    """Transportation information between two points."""

    mode: str  # "walk", "transit", "driving"
    distance_meters: int = Field(..., ge=0)
    duration_minutes: int = Field(..., ge=0)
    instructions: str | None = None
    transit_details: dict | None = None  # For transit mode

    @property
    def distance_km(self) -> float:
        """Get distance in kilometers."""
        return self.distance_meters / 1000

    @property
    def duration_formatted(self) -> str:
        """Format duration as human-readable string."""
        hours = self.duration_minutes // 60
        minutes = self.duration_minutes % 60
        if hours > 0:
            return f"{hours}h {minutes}min"
        return f"{minutes}min"


class RouteSegment(BaseModel):
    """Route segment between two locations."""

    order: int = Field(..., ge=1)
    point: Point
    transport: TransportInfo | None = None
    cumulative_distance_km: float = Field(0, ge=0)
    cumulative_duration_minutes: int = Field(0, ge=0)


class Route(BaseModel):
    """Complete pilgrimage route."""

    origin: Station
    segments: list[RouteSegment]
    total_distance_km: float = Field(..., ge=0)
    total_duration_minutes: int = Field(..., ge=0)
    google_maps_url: HttpUrl | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def total_duration_formatted(self) -> str:
        """Format total duration as human-readable string."""
        hours = self.total_duration_minutes // 60
        minutes = self.total_duration_minutes % 60
        if hours > 0:
            return f"{hours}h {minutes}min"
        return f"{minutes}min"

    @property
    def points_count(self) -> int:
        """Get total number of pilgrimage points."""
        return len(self.segments)

    def get_bangumi_groups(self) -> dict[str, list[Point]]:
        """Group points by bangumi."""
        groups = {}
        for segment in self.segments:
            bangumi_id = segment.point.bangumi_id
            if bangumi_id not in groups:
                groups[bangumi_id] = []
            groups[bangumi_id].append(segment.point)
        return groups


class SeichijunreiSession(BaseModel):
    """User session state."""

    session_id: str
    station: Station | None = None
    selected_bangumi_ids: list[str] = Field(default_factory=list)
    search_radius_km: float = Field(5.0, ge=1, le=20)
    nearby_bangumi: list[Bangumi] = Field(default_factory=list)
    points: list[Point] = Field(default_factory=list)
    route: Route | None = None

    # NEW: Bangumi-specific fields for direct bangumi search
    bangumi_id: str | None = None
    bangumi_name: str | None = None
    bangumi_confidence: float | None = None
    user_location: str | None = None
    user_coordinates: Coordinates | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def update(self):
        """Update the timestamp."""
        self.updated_at = datetime.now(UTC)
