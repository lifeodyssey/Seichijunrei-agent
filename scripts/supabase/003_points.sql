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

CREATE TRIGGER trg_points_updated_at
    BEFORE UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_points_sync_coordinates ON points;

CREATE TRIGGER trg_points_sync_coordinates
    BEFORE INSERT OR UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();

ALTER TABLE points ENABLE ROW LEVEL SECURITY;
