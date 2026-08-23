-- ============================================================
-- 0004_db_hardening.sql — DB-level data integrity hardening
-- Adds CHECK constraints, tightens FK delete rules, and makes
-- audit_log append-only via trigger.
-- All changes are additive (no drops, no data loss).
-- ============================================================

-- ─── 1. lot_entries: quantity invariants ──────────────────
ALTER TABLE lot_entries
  ADD CONSTRAINT chk_lot_qty_non_negative
    CHECK (quantity_produced >= 0 AND quantity_conforming >= 0 AND quantity_rejected >= 0),
  ADD CONSTRAINT chk_lot_conforming_lte_produced
    CHECK (quantity_conforming <= quantity_produced),
  ADD CONSTRAINT chk_lot_cadence_positive
    CHECK (cadence_used > 0),
  ADD CONSTRAINT chk_lot_cadence_unit
    CHECK (cadence_unit IN ('u/h', 'u/min'));

-- ─── 2. downtime_events: duration must be positive ────────
ALTER TABLE downtime_events
  ADD CONSTRAINT chk_dt_duration_positive
    CHECK (duration_minutes > 0);

-- ─── 3. users: role must be a known value ─────────────────
ALTER TABLE users
  ADD CONSTRAINT chk_user_role
    CHECK (role IN ('operator', 'supervisor', 'admin'));

-- ─── 4. equipments: type + cadence unit + TRS range ───────
ALTER TABLE equipments
  ADD CONSTRAINT chk_equip_type
    CHECK (equipment_type IS NULL OR equipment_type IN ('blistereuse', 'geluleuse')),
  ADD CONSTRAINT chk_equip_cadence_unit
    CHECK (default_cadence_unit IN ('u/h', 'u/min')),
  ADD CONSTRAINT chk_equip_trs_objective
    CHECK (trs_objective >= 0 AND trs_objective <= 100);

-- ─── 5. products: cadence unit ────────────────────────────
ALTER TABLE products
  ADD CONSTRAINT chk_product_cadence_unit
    CHECK (cadence_unit IN ('u/h', 'u/min'));

-- ─── 6. product_equipment_cadences: unit + positive value ─
ALTER TABLE product_equipment_cadences
  ADD CONSTRAINT chk_pec_cadence_unit
    CHECK (cadence_unit IN ('u/h', 'u/min')),
  ADD CONSTRAINT chk_pec_cadence_value_positive
    CHECK (cadence_value > 0);

-- ─── 7. phase_templates: category vocabulary ──────────────
ALTER TABLE phase_templates
  ADD CONSTRAINT chk_phase_category
    CHECK (category IN ('production', 'nettoyage', 'changement', 'arret_planifie'));

-- ─── 8. session_events: wire missing FK on lot_entry_id ───
-- Previously a bare uuid with no referential integrity check.
ALTER TABLE session_events
  ADD CONSTRAINT fk_session_events_lot_entry
    FOREIGN KEY (lot_entry_id) REFERENCES lot_entries (id) ON DELETE SET NULL;

-- ─── 9. audit_log: make it append-only ───────────────────
-- NOTE ON actor_id FK: we intentionally keep ON DELETE NO ACTION.
-- In a regulated pharma system, physically deleting a user who has
-- audit records is prohibited by design. Use is_active=false
-- (soft-delete) instead. actorEmail is denormalised as a durable
-- display reference; actor_id is kept for FK integrity while the
-- user record exists.
-- Any UPDATE or DELETE raises an exception regardless of DB role.
-- Backfills and corrections must go through a new INSERT with an
-- explanatory audit action (e.g. CORRECTION) — never silent edits.
CREATE OR REPLACE FUNCTION fn_audit_log_immutable()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are prohibited (action=%, entity=% id=%)',
    OLD.action, OLD.entity_type, OLD.entity_id;
END;
$$;

CREATE TRIGGER tgr_audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_immutable();

CREATE TRIGGER tgr_audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_immutable();
