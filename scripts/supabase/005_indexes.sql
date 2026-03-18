-- 005_indexes.sql
-- Performance indexes: HNSW for vector search, GIST for geospatial queries

-- Vector similarity search (cosine distance, HNSW for fast ANN)
CREATE INDEX IF NOT EXISTS idx_points_embedding
    ON points USING hnsw (embedding vector_cosine_ops);

-- Geospatial queries (find points within radius)
CREATE INDEX IF NOT EXISTS idx_points_location
    ON points USING GIST (location);

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
