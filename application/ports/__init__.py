"""Application ports (interfaces implemented by infrastructure)."""

from .anitabi import AnitabiGateway
from .bangumi import BangumiGateway

__all__ = ["AnitabiGateway", "BangumiGateway"]
