-- ============================================================
-- 0009_performance_and_constraints.sql
-- DB hardening pass 2: missing CHECK constraints + missing indexes
-- All statements are additive, idempotent, and non-destructive.
-- ============================================================

-- ─── 1. session_events: duration must be positive when set ────
DO $$ BEGIN
  ALTER TABLE session_events
    ADD CONSTRAINT chk_session_event_duration_positive
      CHECK (duration_minutes IS NULL OR duration_minutes > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. lot_cadence_changes: cadence values must be positive ──
DO $$ BEGIN
  ALTER TABLE lot_cadence_changes
    ADD CONSTRAINT chk_cadence_changes_values_positive
      CHECK (old_cadence > 0 AND new_cadence > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. lot_cadence_changes: cadence unit vocabulary ──────────
DO $$ BEGIN
  ALTER TABLE lot_cadence_changes
    ADD CONSTRAINT chk_cadence_changes_unit
      CHECK (cadence_unit IN ('u/h', 'u/min'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 4. daily_summaries: ratio columns must be in [0, 1] ──────
-- These are computed TRS/DO/TP/TQ/TRG values — always 0..1.
-- Prevents a bug in the TRS engine from silently writing out-of-range values.
DO $$ BEGIN
  ALTER TABLE daily_summaries
    ADD CONSTRAINT chk_daily_summary_ratios
      CHECK (
        (trs          IS NULL OR (trs          >= 0 AND trs          <= 1)) AND
        (trg          IS NULL OR (trg          >= 0 AND trg          <= 1)) AND
        (disponibilite IS NULL OR (disponibilite >= 0 AND disponibilite <= 1)) AND
        (performance  IS NULL OR (performance  >= 0 AND performance  <= 1)) AND
        (qualite      IS NULL OR (qualite      >= 0 AND qualite      <= 1))
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 5. lot_entries: lot_order must be >= 1 ───────────────────
DO $$ BEGIN
  ALTER TABLE lot_entries
    ADD CONSTRAINT chk_lot_order_positive
      CHECK (lot_order >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 6. products: default cadence must be positive when set ───
DO $$ BEGIN
  ALTER TABLE products
    ADD CONSTRAINT chk_product_default_cadence_positive
      CHECK (default_cadence IS NULL OR default_cadence > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 7. refresh_tokens: indexes for cleanup query ─────────────
-- The maintenance /cleanup-tokens route filters by expiresAt and revokedAt.
-- Without these indexes the DELETE scans the full table on every cron run.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
  ON refresh_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked
  ON refresh_tokens (revoked_at);

-- ─── 8. sessions: operator_id index ──────────────────────────
-- operator_id is a FK to users with no auto-index in Postgres.
-- Used in active-session lookups and ownership checks.
CREATE INDEX IF NOT EXISTS idx_sessions_operator
  ON sessions (operator_id);

-- ─── 9. sessions: (operator_id, status) composite ───────────
-- Hot path: "find active session for this operator" filters both together.
CREATE INDEX IF NOT EXISTS idx_sessions_operator_status
  ON sessions (operator_id, status);

-- ─── 10. lot_entries: operator_id index ──────────────────────
-- FK to users; used in ownership checks and pending-lots join.
CREATE INDEX IF NOT EXISTS idx_lot_entries_operator_id
  ON lot_entries (operator_id);

-- ─── 11. lot_entries: ended_at for ORDER BY in pending-lots ──
-- GET /dashboard/pending-lots orders by desc(endedAt). Without this
-- index Postgres sorts the filtered result in memory.
CREATE INDEX IF NOT EXISTS idx_lot_entries_ended_at
  ON lot_entries (ended_at DESC);

-- ─── 12. lot_entries: (status, ended_at) composite ───────────
-- Covers the combined filter+sort in pending-lots:
--   WHERE status IN ('closed','validated','rejected')
--   ORDER BY ended_at DESC
-- The composite index makes this a single efficient range scan.
CREATE INDEX IF NOT EXISTS idx_lot_entries_status_ended_at
  ON lot_entries (status, ended_at DESC);

-- ─── 13. downtime_events: created_by index ───────────────────
-- Operator ownership check on DELETE /lots/:id/downtimes/:dtId
-- compares created_by to the requesting user.
CREATE INDEX IF NOT EXISTS idx_downtime_events_created_by
  ON downtime_events (created_by);
