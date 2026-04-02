-- DEPRECATED: Legacy SQL snapshot retained for reference/bootstrap only.
-- Canonical migrations now live under `supabase/migrations/`.
-- Do not add new schema changes here.

-- 001_extensions.sql
-- Enable required PostgreSQL extensions for geospatial queries and IDs

CREATE EXTENSION IF NOT EXISTS postgis;     -- PostGIS: geography/geometry types + spatial indexing
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid() for route IDs
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: embeddings + ANN indexes
