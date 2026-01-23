"""Compatibility wrapper for the Bangumi gateway adapter.

New code should prefer importing from `infrastructure.gateways`.
"""

from infrastructure.gateways.bangumi import BangumiClientGateway

__all__ = ["BangumiClientGateway"]
