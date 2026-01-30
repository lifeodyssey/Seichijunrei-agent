"""A2UI Action ID Constants.

Centralized constants for action identifiers used in the A2UI protocol.

A2UI Action IDs Contract (v0.1.0)
"""

# --- Session Control Actions ---

RESET = "reset"
"""Reset the session to initial state."""

BACK = "back"
"""Go back to previous view (e.g., from route to candidates)."""

# --- Candidate Selection Actions (Stage 1) ---

SELECT_CANDIDATE_PREFIX = "select_candidate_"
"""Prefix for candidate selection actions. Format: select_candidate_{n} (1-indexed)."""

# --- Route Editing Actions (Stage 2) ---

REMOVE_POINT_PREFIX = "remove_point_"
"""Prefix for point removal actions. Format: remove_point_{n} (0-indexed)."""

# --- External Link Actions ---

OPEN_URL_PREFIX = "open_url:"
"""Prefix for external URL actions. Format: open_url:{url}."""

# --- Dynamic Text Actions ---

SEND_TEXT_PREFIX = "send_text:"
"""Prefix for text sending actions. Format: send_text:{text}."""


# --- Action ID Builders ---


def select_candidate(index: int) -> str:
    """Build select_candidate action ID.

    Args:
        index: 1-based candidate index

    Returns:
        Action ID like "select_candidate_3"
    """
    return f"{SELECT_CANDIDATE_PREFIX}{index}"


def remove_point(index: int) -> str:
    """Build remove_point action ID.

    Args:
        index: 0-based point index

    Returns:
        Action ID like "remove_point_0"
    """
    return f"{REMOVE_POINT_PREFIX}{index}"


def open_url(url: str) -> str:
    """Build open_url action ID.

    Args:
        url: URL to open

    Returns:
        Action ID like "open_url:https://..."
    """
    return f"{OPEN_URL_PREFIX}{url}"


def send_text(text: str) -> str:
    """Build send_text action ID.

    Args:
        text: Text to send

    Returns:
        Action ID like "send_text:Hello"
    """
    return f"{SEND_TEXT_PREFIX}{text}"


# --- Action ID Parsers ---


def is_select_candidate(action_id: str) -> bool:
    """Check if action ID is a select_candidate action."""
    return action_id.startswith(SELECT_CANDIDATE_PREFIX)


def is_remove_point(action_id: str) -> bool:
    """Check if action ID is a remove_point action."""
    return action_id.startswith(REMOVE_POINT_PREFIX)


def is_open_url(action_id: str) -> bool:
    """Check if action ID is an open_url action."""
    return action_id.startswith(OPEN_URL_PREFIX)


def is_send_text(action_id: str) -> bool:
    """Check if action ID is a send_text action."""
    return action_id.startswith(SEND_TEXT_PREFIX)


def extract_candidate_index(action_id: str) -> int | None:
    """Extract candidate index from select_candidate action.

    Args:
        action_id: Action ID like "select_candidate_3"

    Returns:
        1-based index, or None if invalid
    """
    if not is_select_candidate(action_id):
        return None
    try:
        return int(action_id[len(SELECT_CANDIDATE_PREFIX) :])
    except ValueError:
        return None


def extract_point_index(action_id: str) -> int | None:
    """Extract point index from remove_point action.

    Args:
        action_id: Action ID like "remove_point_0"

    Returns:
        0-based index, or None if invalid
    """
    if not is_remove_point(action_id):
        return None
    try:
        return int(action_id[len(REMOVE_POINT_PREFIX) :])
    except ValueError:
        return None


def extract_url(action_id: str) -> str | None:
    """Extract URL from open_url action.

    Args:
        action_id: Action ID like "open_url:https://..."

    Returns:
        URL string, or None if invalid
    """
    if not is_open_url(action_id):
        return None
    return action_id[len(OPEN_URL_PREFIX) :]


def extract_text(action_id: str) -> str | None:
    """Extract text from send_text action.

    Args:
        action_id: Action ID like "send_text:Hello"

    Returns:
        Text string, or None if invalid
    """
    if not is_send_text(action_id):
        return None
    return action_id[len(SEND_TEXT_PREFIX) :]
