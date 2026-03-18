"""Supabase infrastructure layer.

Async PostgreSQL client for Supabase with pgvector and PostGIS support.
Implements the data access layer for the v2 architecture.
"""

from infrastructure.supabase.client import SupabaseClient

__all__ = ["SupabaseClient"]
