-- DEPRECATED: Legacy SQL snapshot retained for reference/bootstrap only.
-- Canonical migrations now live under `supabase/migrations/`.
-- Do not add new schema changes here.

-- Waitlist table used by the auth gate for beta signup and approval checks.

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
