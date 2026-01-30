"""Compatibility wrapper for the Bangumi gateway adapter.

DEPRECATED: This module is deprecated and will be removed in a future version.
New code should import from `infrastructure.gateways` instead:

    from infrastructure.gateways import BangumiClientGateway
"""

import warnings

from infrastructure.gateways.bangumi import BangumiClientGateway

warnings.warn(
    "clients.bangumi_gateway is deprecated. "
    "Import from infrastructure.gateways instead.",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = ["BangumiClientGateway"]
