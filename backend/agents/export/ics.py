"""ICS calendar serializer for timed itineraries.

No I/O, no LLM calls. Output is a deterministic RFC 5545 string.
"""

from __future__ import annotations

from datetime import date as date_type

from backend.agents.models import TimedItinerary


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

    return "\r\n".join(lines) + "\r\n"


def _to_ical_dt(date: str, hhmm: str) -> str:
    """Convert a YYYYMMDD date and HH:MM time to iCal local datetime: YYYYMMDDTHHmmSS."""
    hh, mm = hhmm.split(":")
    return f"{date}T{hh}{mm}00"
