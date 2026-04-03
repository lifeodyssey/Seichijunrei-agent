"""Supabase infrastructure layer.

Async PostgreSQL client for Supabase with PostGIS support.
Implements the data access layer for the v2 architecture.
"""

from backend.infrastructure.supabase.client import SupabaseClient

__all__ = ["SupabaseClient"]
