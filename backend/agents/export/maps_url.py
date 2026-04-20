"""Google Maps directions URL builder for ordered stop lists.

No I/O, no LLM calls. Output is deterministic given the same inputs.
"""

from __future__ import annotations

from backend.agents.models import TimedStop

_MAPS_BASE = "https://www.google.com/maps/dir/"
_CHUNK_SIZE = 10


def build_google_maps_url(stops: list[TimedStop]) -> list[str]:
    """Build Google Maps directions URL(s) from an ordered list of stops.

    Always returns a list for consistent downstream handling:
    - Empty list  → []
    - 1–10 stops  → [single URL]
    - >10 stops   → [URL1, URL2, ...]; chunks of 10 with 1-stop overlap
    """
    if not stops:
        return []

    if len(stops) <= _CHUNK_SIZE:
        return [_url_from_stops(stops)]

    chunks: list[list[TimedStop]] = []
    i = 0
    while i < len(stops):
        chunk = stops[i : i + _CHUNK_SIZE]
        chunks.append(chunk)
        i += _CHUNK_SIZE - 1

    return [_url_from_stops(chunk) for chunk in chunks]


def _url_from_stops(stops: list[TimedStop]) -> str:
    waypoints = "/".join(f"{s.lat},{s.lng}" for s in stops)
    return f"{_MAPS_BASE}{waypoints}"
