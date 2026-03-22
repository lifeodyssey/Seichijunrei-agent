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

CREATE TRIGGER trg_bangumi_updated_at
    BEFORE UPDATE ON bangumi
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
