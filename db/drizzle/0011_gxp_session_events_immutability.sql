-- ============================================================
-- 0011_gxp_session_events_immutability.sql
-- GxP hardening: session_events immutability + daily_summaries audit
-- Implements 21 CFR Part 11 / NF E 60-182 record integrity requirements.
-- All statements are idempotent (CREATE OR REPLACE / DROP IF EXISTS).
-- ============================================================

-- ─── 1. session_events immutability trigger ───────────────────
-- Prevent UPDATE or DELETE on session_events rows whose parent session
-- is already 'closed'. The close operation itself (setting duration_minutes)
-- runs WHILE the session is still 'active', so this trigger fires only
-- after the session is truly closed — no false positives.

CREATE OR REPLACE FUNCTION fn_prevent_closed_session_event_mutation()
RETURNS trigger AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM sessions
    WHERE id = COALESCE(OLD.session_id, NEW.session_id);
  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'GxP: session_events cannot be modified after session is closed';
  END IF;
  -- BEFORE UPDATE must return NEW (returning OLD silently discards the write,
  -- which would drop the duration_minutes set during session close on a
  -- still-active session). BEFORE DELETE must return OLD to allow the delete.
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_events_immutable ON session_events;
CREATE TRIGGER trg_session_events_immutable
  BEFORE UPDATE OR DELETE ON session_events
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_closed_session_event_mutation();

-- ─── 2. daily_summaries audit trigger ────────────────────────
-- Log every INSERT/UPDATE/DELETE on daily_summaries to audit_log.
-- daily_summaries is a derived TRS cache; we do not block recomputation
-- but we trace every mutation so unexpected changes are detectable.
--
-- Notes on column mapping (audit_log schema):
--   actor_id    — NULL for system-level trigger (no user context in plpgsql)
--   actor_email — '' sentinel; NOT NULL column requires a value
--   entity_id   — UUID; COALESCE(NEW.id, OLD.id) is already UUID
--   payload     — text column; cast jsonb snapshot to text

CREATE OR REPLACE FUNCTION fn_audit_daily_summary_changes()
RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_log (action, entity_type, entity_id, actor_id, actor_email, payload)
  VALUES (
    TG_OP,
    'daily_summary',
    COALESCE(NEW.id, OLD.id),
    NULL,   -- system-level operation; no user context in trigger
    '',     -- actor_email is NOT NULL; empty string signals system origin
    jsonb_build_object(
      'old', to_jsonb(OLD),
      'new', to_jsonb(NEW)
    )::text
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_summaries_audit ON daily_summaries;
CREATE TRIGGER trg_daily_summaries_audit
  AFTER INSERT OR UPDATE OR DELETE ON daily_summaries
  FOR EACH ROW EXECUTE FUNCTION fn_audit_daily_summary_changes();
