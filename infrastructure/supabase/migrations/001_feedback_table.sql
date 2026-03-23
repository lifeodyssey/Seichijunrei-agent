-- Feedback table for the eval feedback flywheel.
-- User 👍/👎 ratings are stored here alongside the query and intent,
-- then periodically exported to pydantic-evals regression datasets.

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT,
  query_text TEXT NOT NULL,
  intent TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback (rating);
CREATE INDEX IF NOT EXISTS idx_feedback_intent ON feedback (intent);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);
