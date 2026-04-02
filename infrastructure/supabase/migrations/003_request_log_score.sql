-- DEPRECATED: Legacy SQL snapshot retained for reference/bootstrap only.
-- Canonical migrations now live under `supabase/migrations/`.
-- Do not add new schema changes here.

-- Add LLM auto-score column to request_log.
-- Populated by tools/eval_scorer.py (offline batch job).

ALTER TABLE request_log
    ADD COLUMN IF NOT EXISTS plan_quality_score REAL;

CREATE INDEX IF NOT EXISTS idx_request_log_unscored
    ON request_log (id)
    WHERE plan_quality_score IS NULL;
