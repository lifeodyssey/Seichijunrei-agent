"""A2A Server package.

This package provides an A2A (Agent-to-Agent) protocol server
for the Seichijunrei bot, following Google's A2A specification.
"""

from .server import A2AServer, create_app
from .session import InMemorySessionAdapter, SessionAdapter

__all__ = [
    "A2AServer",
    "create_app",
    "SessionAdapter",
    "InMemorySessionAdapter",
]
