CREATE TABLE IF NOT EXISTS conversations (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    first_query TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id_updated_at
    ON conversations (user_id, updated_at DESC);
