"""Compatibility wrapper for the Anitabi gateway adapter.

New code should prefer importing from `infrastructure.gateways`.
"""

from infrastructure.gateways.anitabi import AnitabiClientGateway

__all__ = ["AnitabiClientGateway"]
