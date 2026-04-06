-- Chat message persistence
CREATE TABLE IF NOT EXISTS conversation_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES conversations(session_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    response_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON conversation_messages(session_id, created_at);

-- RLS: users can only read their own messages
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select_own ON conversation_messages
    FOR SELECT USING (
        session_id IN (
            SELECT session_id FROM conversations WHERE user_id = auth.uid()::text
        )
    );
