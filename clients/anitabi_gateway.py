"""Compatibility wrapper for the Anitabi gateway adapter.

DEPRECATED: This module is deprecated and will be removed in a future version.
New code should import from `infrastructure.gateways` instead:

    from infrastructure.gateways import AnitabiClientGateway
"""

import warnings

from infrastructure.gateways.anitabi import AnitabiClientGateway

warnings.warn(
    "clients.anitabi_gateway is deprecated. "
    "Import from infrastructure.gateways instead.",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = ["AnitabiClientGateway"]
