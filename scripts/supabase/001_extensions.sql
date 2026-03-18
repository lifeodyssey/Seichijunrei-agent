-- 001_extensions.sql
-- Enable required PostgreSQL extensions for vector search and geospatial queries

CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: HNSW vector similarity search
CREATE EXTENSION IF NOT EXISTS postgis;     -- PostGIS: geography/geometry types + spatial indexing
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid() for route IDs
