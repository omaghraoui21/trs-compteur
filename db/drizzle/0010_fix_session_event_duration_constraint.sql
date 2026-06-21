-- ============================================================
-- 0010_fix_session_event_duration_constraint.sql
-- Fix: duration_minutes >= 0 (was > 0 in 0009)
-- Sub-minute session events legitimately produce duration_minutes = 0
-- when ROUND(EXTRACT(EPOCH FROM interval) / 60) truncates to zero.
-- ============================================================

-- Drop the overly strict constraint added in 0009
ALTER TABLE session_events DROP CONSTRAINT IF EXISTS chk_session_event_duration_positive;

-- Re-add allowing zero
DO $$ BEGIN
  ALTER TABLE session_events
    ADD CONSTRAINT chk_session_event_duration_positive
      CHECK (duration_minutes IS NULL OR duration_minutes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
