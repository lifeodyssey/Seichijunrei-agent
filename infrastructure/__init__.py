"""Infrastructure layer.

This package contains concrete implementations for external dependencies
(HTTP APIs, SDKs, caches, etc.) and adapters that implement application ports.

The interface layer (e.g. `adk_agents/`) may depend on infrastructure to build
the runtime graph. The application layer must not depend on infrastructure.
"""
