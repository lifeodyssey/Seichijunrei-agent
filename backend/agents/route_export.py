"""Pure export helpers for route data — Google Maps URL builder and .ics generator.

No LLM calls. No I/O. Both functions are deterministic given the same inputs.
"""

from __future__ import annotations

from datetime import date as date_type

from backend.agents.models import TimedItinerary, TimedStop

_MAPS_BASE = "https://www.google.com/maps/dir/"
_CHUNK_SIZE = 10


def build_google_maps_url(stops: list[TimedStop]) -> str | list[str]:
    """Build Google Maps directions URL(s) from an ordered list of stops.

    - Empty list  → ""
    - 1–10 stops  → single URL string
    - >10 stops   → list of URLs; chunks of 10 with 1-stop overlap so routes
                    connect (last stop of chunk N = first stop of chunk N+1)
    """
    if not stops:
        return ""

    if len(stops) <= _CHUNK_SIZE:
        return _url_from_stops(stops)

    # Split with overlap of 1
    chunks: list[list[TimedStop]] = []
    i = 0
    while i < len(stops):
        chunk = stops[i : i + _CHUNK_SIZE]
        chunks.append(chunk)
        i += _CHUNK_SIZE - 1  # step forward by 9 so last stop overlaps

    return [_url_from_stops(chunk) for chunk in chunks]


def _url_from_stops(stops: list[TimedStop]) -> str:
    waypoints = "/".join(f"{s.lat},{s.lng}" for s in stops)
    return f"{_MAPS_BASE}{waypoints}"


def build_ics_calendar(
    itinerary: TimedItinerary,
    title: str = "聖地巡礼",
    date: str = "",
) -> str:
    """Serialize a TimedItinerary as an iCalendar (.ics) string.

    Args:
        itinerary: The timed route to serialize.
        title:     Calendar display name (unused in VEVENT SUMMARY; kept for
                   future X-WR-CALNAME support).
        date:      Date string in YYYYMMDD format.  Defaults to today.

    Returns:
        RFC 5545-compliant iCalendar string with CRLF line endings.
    """
    if not date:
        date = date_type.today().strftime("%Y%m%d")

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Seichijunrei//EN",
        "CALSCALE:GREGORIAN",
    ]

    for stop in itinerary.stops:
        dtstart = _to_ical_dt(date, stop.arrive)
        dtend = _to_ical_dt(date, stop.depart)
        lines += [
            "BEGIN:VEVENT",
            f"DTSTART:{dtstart}",
            f"DTEND:{dtend}",
            f"SUMMARY:{stop.name}",
            f"DESCRIPTION:{stop.photo_count} scenes",
            "END:VEVENT",
        ]

    lines.append("END:VCALENDAR")

    # iCal spec (RFC 5545 §3.1) requires CRLF line endings
    return "\r\n".join(lines) + "\r\n"


def _to_ical_dt(date: str, hhmm: str) -> str:
    """Convert a YYYYMMDD date and HH:MM time to iCal local datetime: YYYYMMDDTHHmmSS."""
    hh, mm = hhmm.split(":")
    return f"{date}T{hh}{mm}00"
