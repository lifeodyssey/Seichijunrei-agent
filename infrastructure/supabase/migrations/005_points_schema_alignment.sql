-- Align the points table with the current runtime contract.
-- Non-destructive on existing databases:
-- - add runtime columns if missing
-- - backfill from legacy columns / geography values
-- - keep legacy columns in place to avoid data loss

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE points
    ADD COLUMN IF NOT EXISTS name_cn TEXT,
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS image TEXT,
    ADD COLUMN IF NOT EXISTS scene_desc TEXT,
    ADD COLUMN IF NOT EXISTS embedding vector(1024);

ALTER TABLE points
    ALTER COLUMN bangumi_id DROP NOT NULL,
    ALTER COLUMN location DROP NOT NULL,
    ALTER COLUMN episode DROP DEFAULT,
    ALTER COLUMN time_seconds SET DEFAULT 0;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points'
          AND column_name = 'cn_name'
    ) THEN
        EXECUTE $sql$
            UPDATE points
            SET name_cn = COALESCE(name_cn, cn_name)
            WHERE cn_name IS NOT NULL
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points'
          AND column_name = 'screenshot_url'
    ) THEN
        EXECUTE $sql$
            UPDATE points
            SET image = COALESCE(image, screenshot_url)
            WHERE screenshot_url IS NOT NULL
        $sql$;
    END IF;
END $$;

UPDATE points
SET latitude = COALESCE(latitude, ST_Y(location::geometry)),
    longitude = COALESCE(longitude, ST_X(location::geometry))
WHERE location IS NOT NULL;

UPDATE points
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE location IS NULL
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL;

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

DROP TRIGGER IF EXISTS trg_points_sync_coordinates ON points;

CREATE TRIGGER trg_points_sync_coordinates
    BEFORE INSERT OR UPDATE ON points
    FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();

CREATE INDEX IF NOT EXISTS idx_points_embedding
    ON points USING HNSW (embedding vector_cosine_ops);

ALTER TABLE points
    ALTER COLUMN latitude SET NOT NULL,
    ALTER COLUMN longitude SET NOT NULL;
