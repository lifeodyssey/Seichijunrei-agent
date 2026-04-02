-- DEPRECATED: Legacy SQL snapshot retained for reference/bootstrap only.
-- Canonical migrations now live under `supabase/migrations/`.
-- Do not add new schema changes here.

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
