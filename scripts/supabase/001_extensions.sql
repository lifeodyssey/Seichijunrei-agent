-- 001_extensions.sql
-- Enable required PostgreSQL extensions for geospatial queries and IDs

CREATE EXTENSION IF NOT EXISTS postgis;     -- PostGIS: geography/geometry types + spatial indexing
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid() for route IDs
