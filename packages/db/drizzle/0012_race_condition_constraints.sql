-- Partial unique index: only one active session per equipment at a time (TOCTOU guard)
CREATE UNIQUE INDEX "uq_sessions_one_active_per_equip" ON "sessions" USING btree ("equipment_id") WHERE status = 'active';
--> statement-breakpoint
-- Unique index: batch number must be unique within a session
CREATE UNIQUE INDEX "uq_lot_entries_session_batch" ON "lot_entries" USING btree ("session_id","batch_number");
--> statement-breakpoint
-- Partial unique index: only one active lot per session at a time (TOCTOU guard)
CREATE UNIQUE INDEX "uq_lot_entries_one_active_per_session" ON "lot_entries" USING btree ("session_id") WHERE status = 'active';
--> statement-breakpoint
-- Check constraint: validated/rejected lots must have a supervisor and validation timestamp
ALTER TABLE "lot_entries" ADD CONSTRAINT "chk_lot_validation_complete" CHECK (
    (status IN ('validated', 'rejected') AND supervisor_id IS NOT NULL AND validated_at IS NOT NULL)
    OR status NOT IN ('validated', 'rejected')
  );
