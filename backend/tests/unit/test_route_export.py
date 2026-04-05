"""Unit tests for route_export module — Google Maps URL builder and .ics generator."""

from backend.agents.models import TimedItinerary, TimedStop
from backend.agents.route_export import build_google_maps_url, build_ics_calendar


def _make_stop(
    cluster_id: str,
    lat: float,
    lng: float,
    name: str = "test",
    arrive: str = "09:00",
    depart: str = "09:10",
) -> TimedStop:
    return TimedStop(
        cluster_id=cluster_id,
        name=name,
        arrive=arrive,
        depart=depart,
        dwell_minutes=10,
        lat=lat,
        lng=lng,
        photo_count=1,
    )


def test_google_maps_url_3_stops() -> None:
    stops = [_make_stop(f"s{i}", 34.89 + i * 0.01, 135.80) for i in range(3)]
    url = build_google_maps_url(stops)
    assert isinstance(url, str)
    assert url.startswith("https://www.google.com/maps/dir/")
    assert "34.89" in url
    assert "34.91" in url


def test_google_maps_url_12_stops() -> None:
    stops = [_make_stop(f"s{i}", 34.89 + i * 0.01, 135.80) for i in range(12)]
    urls = build_google_maps_url(stops)
    assert isinstance(urls, list)
    assert len(urls) == 2


def test_google_maps_url_empty() -> None:
    result = build_google_maps_url([])
    assert result == ""


def test_ics_contains_vcalendar() -> None:
    itinerary = TimedItinerary(
        stops=[_make_stop("a", 34.89, 135.80, "宇治橋")], spot_count=1
    )
    ics = build_ics_calendar(itinerary, date="20260405")
    assert "BEGIN:VCALENDAR" in ics
    assert "END:VCALENDAR" in ics


def test_ics_event_count() -> None:
    stops = [
        _make_stop(f"s{i}", 34.89 + i * 0.01, 135.80, f"spot{i}") for i in range(3)
    ]
    itinerary = TimedItinerary(stops=stops, spot_count=3)
    ics = build_ics_calendar(itinerary, date="20260405")
    assert ics.count("BEGIN:VEVENT") == 3


def test_ics_japanese_names() -> None:
    itinerary = TimedItinerary(
        stops=[_make_stop("a", 34.89, 135.80, "宇治橋")], spot_count=1
    )
    ics = build_ics_calendar(itinerary, date="20260405")
    assert "宇治橋" in ics


def test_ics_time_format() -> None:
    stop = _make_stop("a", 34.89, 135.80, arrive="09:15", depart="09:25")
    itinerary = TimedItinerary(stops=[stop], spot_count=1)
    ics = build_ics_calendar(itinerary, date="20260405")
    assert "DTSTART:20260405T091500" in ics
    assert "DTEND:20260405T092500" in ics
