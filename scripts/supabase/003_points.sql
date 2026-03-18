-- 003_points.sql
-- Pilgrimage points with vector embeddings (BGE-M3 1024-dim) and PostGIS geography

CREATE TABLE IF NOT EXISTS points (
    id              TEXT PRIMARY KEY,
    bangumi_id      TEXT NOT NULL REFERENCES bangumi(id),
    name            TEXT NOT NULL,
    cn_name         TEXT,
    address         TEXT,
    episode         INTEGER DEFAULT 0,
    time_seconds    INTEGER DEFAULT 0,
    screenshot_url  TEXT,
    origin          TEXT,
    origin_url      TEXT,
    opening_hours   TEXT,
    admission_fee   TEXT,
    location        GEOGRAPHY(POINT, 4326) NOT NULL,
    embedding       VECTOR(1024),
    search_text     TEXT GENERATED ALWAYS AS (
        COALESCE(name, '') || ' ' || COALESCE(cn_name, '') || ' ' || COALESCE(address, '')
    ) STORED,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_points_updated_at
    BEFORE UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
