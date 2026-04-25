"""Input and output guardrails for the pilgrimage agent.

Three checkpoint layers:
1. Input guard: length limit + prompt injection detection
2. Output guard: coordinate range check (hallucination detection)
3. Translation gate: locale mismatch detection (separate module)
"""

from __future__ import annotations

import re

import structlog

logger = structlog.get_logger(__name__)

MAX_INPUT_LENGTH = 2000

INJECTION_PATTERNS = [
    re.compile(r"ignore (previous|above|all) \w{0,20} ?(instructions|prompts)", re.I),
    re.compile(r"you are now ", re.I),
    re.compile(r"system *: *", re.I),
    re.compile(r"<\s*/?script", re.I),
    re.compile(r"DROP TABLE", re.I),
    re.compile(r"UNION SELECT", re.I),
    re.compile(r"; *DELETE FROM", re.I),
    re.compile(r"<iframe", re.I),
]

# Japan coordinate bounds (with margin for outlying islands)
JAPAN_LAT_MIN, JAPAN_LAT_MAX = 24.0, 46.0
JAPAN_LNG_MIN, JAPAN_LNG_MAX = 122.0, 154.0


def check_input_length(text: str) -> str | None:
    """Return error message if input is too long, None if OK."""
    if len(text) > MAX_INPUT_LENGTH:
        return f"Input too long ({len(text)} chars, max {MAX_INPUT_LENGTH})"
    return None


def detect_prompt_injection(text: str) -> bool:
    """Return True if text looks like a prompt injection attempt.

    Detects common injection patterns. Does NOT block the request —
    callers should log a warning and let the agent process normally,
    since PydanticAI's typed output already constrains what the agent
    can return.
    """
    for pattern in INJECTION_PATTERNS:
        if pattern.search(text):
            logger.warning(
                "prompt_injection_detected",
                pattern=pattern.pattern,
                text=text[:100],
            )
            return True
    return False


def check_coordinates_in_japan(lat: float, lng: float) -> bool:
    """Return True if coordinates are within Japan's bounds.

    Used as a hallucination guard: if the agent returns pilgrimage
    points outside Japan, they are flagged (not deleted).
    """
    return (
        JAPAN_LAT_MIN <= lat <= JAPAN_LAT_MAX and JAPAN_LNG_MIN <= lng <= JAPAN_LNG_MAX
    )
