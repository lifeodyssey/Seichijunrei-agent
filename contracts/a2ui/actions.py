"""A2UI Action Definitions.

Actions represent user interactions that are dispatched back to the agent.

A2UI Actions Contract (v0.1.0)
"""

from enum import Enum
from typing import TypedDict


class ActionName(str, Enum):
    """Defined action names.

    Action names follow these patterns:
    - select_candidate_{n}: Select the n-th candidate (1-indexed)
    - remove_point_{n}: Remove the n-th point from route (0-indexed)
    - reset: Reset the session to initial state
    - send_text:{text}: Send text as a user message (for quick prompts)
    - open_maps_url: Open Google Maps directions URL
    """

    # Session control
    RESET = "reset"

    # Candidates view actions (Stage 1)
    # Pattern: select_candidate_1, select_candidate_2, ...
    SELECT_CANDIDATE_PREFIX = "select_candidate_"

    # Route view actions (Stage 2)
    # Pattern: remove_point_0, remove_point_1, ...
    REMOVE_POINT_PREFIX = "remove_point_"

    # External links
    OPEN_MAPS_URL = "open_maps_url"

    # Dynamic text sending
    # Pattern: send_text:Hello there
    SEND_TEXT_PREFIX = "send_text:"


class ActionPayload(TypedDict, total=False):
    """Payload sent with an action.

    Different actions may include different fields:
    - action_name: The action identifier
    - index: For indexed actions (select_candidate, remove_point)
    - text: For send_text actions
    - url: For external link actions
    """

    action_name: str
    index: int  # For indexed actions
    text: str  # For send_text actions
    url: str  # For external links


def parse_action(action_name: str) -> ActionPayload:
    """Parse an action name into a structured payload.

    Args:
        action_name: The raw action string (e.g., "select_candidate_3")

    Returns:
        Structured action payload with action_name and any extracted data.
    """
    payload: ActionPayload = {"action_name": action_name}

    # Parse indexed actions
    if action_name.startswith(ActionName.SELECT_CANDIDATE_PREFIX):
        try:
            index_str = action_name[len(ActionName.SELECT_CANDIDATE_PREFIX) :]
            payload["index"] = int(index_str)
        except ValueError:
            pass

    elif action_name.startswith(ActionName.REMOVE_POINT_PREFIX):
        try:
            index_str = action_name[len(ActionName.REMOVE_POINT_PREFIX) :]
            payload["index"] = int(index_str)
        except ValueError:
            pass

    elif action_name.startswith(ActionName.SEND_TEXT_PREFIX):
        text = action_name[len(ActionName.SEND_TEXT_PREFIX) :]
        payload["text"] = text

    return payload


def make_select_candidate_action(index: int) -> str:
    """Create a select_candidate action name.

    Args:
        index: 1-based candidate index

    Returns:
        Action name like "select_candidate_3"
    """
    return f"{ActionName.SELECT_CANDIDATE_PREFIX}{index}"


def make_remove_point_action(index: int) -> str:
    """Create a remove_point action name.

    Args:
        index: 0-based point index

    Returns:
        Action name like "remove_point_0"
    """
    return f"{ActionName.REMOVE_POINT_PREFIX}{index}"


def make_send_text_action(text: str) -> str:
    """Create a send_text action name.

    Args:
        text: Text to send as user message

    Returns:
        Action name like "send_text:Hello there"
    """
    return f"{ActionName.SEND_TEXT_PREFIX}{text}"
