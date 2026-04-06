-- 20260406130000_bangumi_city.sql
-- Add city column to bangumi table for Anitabi /lite metadata.
-- The cover_url and title_cn columns already exist; city is new.

ALTER TABLE bangumi ADD COLUMN IF NOT EXISTS city TEXT;
