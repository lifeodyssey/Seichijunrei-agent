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
