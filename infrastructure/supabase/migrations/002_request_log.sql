-- Request log for eval flywheel.
-- Written after every /v1/runtime response. Never blocks the response.
-- plan_steps JSONB stores the list of tool/step names in execution order.

CREATE TABLE IF NOT EXISTS request_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id  TEXT,
    query_text  TEXT NOT NULL,
    locale      TEXT NOT NULL DEFAULT 'ja',
    plan_steps  JSONB,
    intent      TEXT,
    status      TEXT,
    latency_ms  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_log_locale  ON request_log (locale);
CREATE INDEX IF NOT EXISTS idx_request_log_intent  ON request_log (intent);

