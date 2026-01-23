"""Compatibility wrapper for the route planner gateway adapter.

New code should prefer importing from `infrastructure.gateways`.
"""

from infrastructure.gateways.route_planner import SimpleRoutePlannerGateway

__all__ = ["SimpleRoutePlannerGateway"]
