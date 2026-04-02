-- API keys for agent/CLI access.
-- The raw key (sk_<hex>) is shown to the user exactly once.
-- Only the SHA-256 hex-encoded hash is stored here.

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked      BOOLEAN NOT NULL DEFAULT false
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

CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys (key_hash) WHERE NOT revoked;
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);
