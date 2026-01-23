"""A2UI Type Definitions.

Basic types used across the A2UI contract.
"""

from enum import Enum
from typing import Literal


class SurfaceId(str, Enum):
    """Surface identifiers for A2UI rendering targets.

    A surface represents a rendering area in the UI.
    """

    MAIN = "main"  # Primary content surface


class ViewName(str, Enum):
    """Logical view names for different UI states.

    Views map to different stages of the pilgrimage planning flow.
    """

    WELCOME = "welcome"  # Initial state, no session data
    CANDIDATES = "candidates"  # Stage 1: Bangumi candidate selection
    ROUTE = "route"  # Stage 2: Route planning and display
    ERROR = "error"  # Error state


# Language codes supported by the UI
LanguageCode = Literal["zh-CN", "en", "ja"]

# Text usage hints for styling
TextUsageHint = Literal["h1", "h2", "h3", "h4", "body", "caption"]

# Layout distribution options
Distribution = Literal["start", "center", "end", "space-between", "space-around"]

# Layout alignment options
Alignment = Literal["start", "center", "end", "stretch"]
