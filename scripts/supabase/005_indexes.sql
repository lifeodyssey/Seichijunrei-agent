-- DEPRECATED: Legacy SQL snapshot retained for reference/bootstrap only.
-- Canonical migrations now live under `supabase/migrations/`.
-- Do not add new schema changes here.

-- 005_indexes.sql
-- Performance indexes: GIST for geospatial queries and standard relational lookups

-- Geospatial queries (find points within radius)
CREATE INDEX IF NOT EXISTS idx_points_location
    ON points USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_points_embedding
    ON points USING HNSW (embedding vector_cosine_ops);

-- Foreign key lookups
CREATE INDEX IF NOT EXISTS idx_points_bangumi
    ON points (bangumi_id);

-- Session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle
    ON sessions (lifecycle);

-- Route lookups
CREATE INDEX IF NOT EXISTS idx_routes_session
    ON routes (session_id);

CREATE INDEX IF NOT EXISTS idx_routes_bangumi
    ON routes (bangumi_id);
