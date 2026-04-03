"""Port adapters (infrastructure) for the application layer."""

from .anitabi import AnitabiClientGateway
from .bangumi import BangumiClientGateway

__all__ = [
    "AnitabiClientGateway",
    "BangumiClientGateway",
]
