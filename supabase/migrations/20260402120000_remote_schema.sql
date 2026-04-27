-- 20260402120000_remote_schema.sql
-- Baseline of the live app-owned public schema, assembled from the repo's
-- bootstrap SQL sources and kept intentionally limited to application scope.

-- 001_extensions.sql
-- Enable required PostgreSQL extensions for geospatial queries and IDs

CREATE EXTENSION IF NOT EXISTS postgis;     -- PostGIS: geography/geometry types + spatial indexing
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid() for route IDs
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: embeddings + ANN indexes

-- 002_bangumi.sql
-- Anime metadata table (seed: 5-10 popular anime with pilgrimage sites)

CREATE TABLE IF NOT EXISTS bangumi (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    title_cn        TEXT,
    cover_url       TEXT,
    air_date        TEXT,
    summary         TEXT,
    eps_count       INTEGER,
    rating          REAL,
    points_count    INTEGER DEFAULT 0,
    primary_color   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bangumi_updated_at ON bangumi;
CREATE TRIGGER trg_bangumi_updated_at
    BEFORE UPDATE ON bangumi
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE bangumi ENABLE ROW LEVEL SECURITY;

-- 003_points.sql
-- Pilgrimage points with current runtime column names and geo coordinates

CREATE TABLE IF NOT EXISTS points (
    id              TEXT PRIMARY KEY,
    bangumi_id      TEXT REFERENCES bangumi(id),
    name            TEXT NOT NULL,
    name_cn         TEXT,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    location        GEOGRAPHY(POINT, 4326),
    image           TEXT,
    episode         INTEGER,
    time_seconds    INTEGER DEFAULT 0,
    scene_desc      TEXT,
    embedding       vector(1024),
    origin          TEXT,
    origin_url      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION sync_points_coordinates()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.location IS NULL
       AND NEW.latitude IS NOT NULL
       AND NEW.longitude IS NOT NULL THEN
        NEW.location := ST_SetSRID(
            ST_MakePoint(NEW.longitude, NEW.latitude),
            4326
        )::geography;
    ELSIF NEW.location IS NOT NULL THEN
        NEW.latitude := COALESCE(NEW.latitude, ST_Y(NEW.location::geometry));
        NEW.longitude := COALESCE(NEW.longitude, ST_X(NEW.location::geometry));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_points_updated_at ON points;
CREATE TRIGGER trg_points_updated_at
    BEFORE UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_points_sync_coordinates ON points;

CREATE TRIGGER trg_points_sync_coordinates
    BEFORE INSERT OR UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();

ALTER TABLE points ENABLE ROW LEVEL SECURITY;

-- 004_sessions_routes.sql
-- Session state and computed route history

CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT,
    state           JSONB NOT NULL DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    lifecycle       TEXT DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON sessions;
CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT REFERENCES sessions(id),
    bangumi_id      TEXT REFERENCES bangumi(id),
    origin_station  TEXT,
    origin_location GEOGRAPHY(POINT, 4326),
    point_ids       TEXT[] NOT NULL,
    total_distance  REAL,
    total_duration  INTEGER,
    route_data      JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE routes ENABLE ROW LEVEL SECURITY;

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

-- 006_operational_tables.sql
-- Operational / product tables not covered by the core bangumi + route bootstrap.

CREATE TABLE IF NOT EXISTS feedback (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  TEXT,
    query_text  TEXT NOT NULL,
    intent      TEXT,
    rating      TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
    comment     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feedback_rating
    ON feedback (rating);

CREATE INDEX IF NOT EXISTS idx_feedback_intent
    ON feedback (intent);

CREATE INDEX IF NOT EXISTS idx_feedback_created
    ON feedback (created_at DESC);

CREATE TABLE IF NOT EXISTS request_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id          TEXT,
    query_text          TEXT NOT NULL,
    locale              TEXT NOT NULL DEFAULT 'ja',
    plan_steps          JSONB,
    intent              TEXT,
    status              TEXT,
    latency_ms          INTEGER,
    plan_quality_score  REAL
);

ALTER TABLE request_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_request_log_created
    ON request_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_log_locale
    ON request_log (locale);

CREATE INDEX IF NOT EXISTS idx_request_log_intent
    ON request_log (intent);

CREATE INDEX IF NOT EXISTS idx_request_log_unscored
    ON request_log (id)
    WHERE plan_quality_score IS NULL;

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'api_keys'
          AND policyname = 'Users manage their own keys'
    ) THEN
        CREATE POLICY "Users manage their own keys"
            ON api_keys
            FOR ALL
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_keys_hash
    ON api_keys (key_hash)
    WHERE NOT revoked;

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
    ON api_keys (user_id);

CREATE TABLE IF NOT EXISTS waitlist (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status      TEXT NOT NULL DEFAULT 'pending'
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'waitlist'
          AND policyname = 'Anyone can join waitlist'
    ) THEN
        CREATE POLICY "Anyone can join waitlist"
            ON waitlist
            FOR INSERT
            TO anon
            WITH CHECK (TRUE);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'waitlist'
          AND policyname = 'Service role can read waitlist'
    ) THEN
        CREATE POLICY "Service role can read waitlist"
            ON waitlist
            FOR SELECT
            TO service_role
            USING (TRUE);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'waitlist'
          AND policyname = 'anon_select_waitlist'
    ) THEN
        CREATE POLICY "anon_select_waitlist"
            ON waitlist
            FOR SELECT
            TO anon
            USING (TRUE);
    END IF;
END $$;
