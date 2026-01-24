"""Intent enum for type-safe intent management.

This module defines the Intent enum used throughout the intent routing system
for classifying user messages into actionable intents.
"""

from enum import Enum


class Intent(str, Enum):
    """User intent enumeration for the Seichijunrei Bot.

    Each intent maps to a specific handler or workflow in the routing system.
    Using str as base class allows direct JSON serialization.
    """

    WELCOME = "welcome"        # New session welcome
    HELP = "help"              # Help request
    RESET = "reset"            # Reset session
    BACK = "back"              # Return to previous step
    ANIME_SEARCH = "search"    # Search for anime
    SELECTION = "select"       # Select from candidates
    GREETING = "greeting"      # Greeting (hi, hello, etc.)
    CHITCHAT = "chitchat"      # Casual conversation
    UNKNOWN = "unknown"        # Cannot determine intent
