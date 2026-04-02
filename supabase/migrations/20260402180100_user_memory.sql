CREATE TABLE IF NOT EXISTS user_memory (
    user_id TEXT PRIMARY KEY,
    visited_anime JSONB NOT NULL DEFAULT '[]'::jsonb,
    visited_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
