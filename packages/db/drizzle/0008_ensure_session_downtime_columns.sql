-- Idempotent safety migration: ensures downtime_events.session_id and the
-- lot_cadence_changes table exist in the Railway DB.
--
-- Root cause: same pattern as 0002 — the Railway DB was bootstrapped via
-- db:push before (or instead of) the Drizzle ORM migrate() runner, so
-- migration 0006/0007 SQL may have been recorded as applied in
-- __drizzle_migrations without the DDL having actually executed.
-- Each statement is guarded with IF NOT EXISTS / EXCEPTION blocks so it is
-- completely safe to run multiple times.

-- Ensure lot_entry_id is nullable (migration 0006 step 1)
ALTER TABLE "downtime_events" ALTER COLUMN "lot_entry_id" DROP NOT NULL;--> statement-breakpoint

-- Ensure session_id column exists (migration 0006 step 2)
ALTER TABLE "downtime_events" ADD COLUMN IF NOT EXISTS "session_id" uuid;--> statement-breakpoint

-- FK downtime_events.session_id → sessions (migration 0006 step 3)
DO $$ BEGIN
  ALTER TABLE "downtime_events"
    ADD CONSTRAINT "downtime_events_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- CHECK: at least one of lot_entry_id or session_id must be set
DO $$ BEGIN
  ALTER TABLE "downtime_events"
    ADD CONSTRAINT "downtime_events_lot_or_session"
    CHECK ("lot_entry_id" IS NOT NULL OR "session_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Index on session_id (migration 0006 step 5)
CREATE INDEX IF NOT EXISTS "idx_downtime_events_session" ON "downtime_events" USING btree ("session_id");--> statement-breakpoint

-- lot_cadence_changes table (migration 0007)
CREATE TABLE IF NOT EXISTS "lot_cadence_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lot_entry_id" uuid NOT NULL,
  "old_cadence" numeric(10,2) NOT NULL,
  "new_cadence" numeric(10,2) NOT NULL,
  "cadence_unit" text DEFAULT 'u/min' NOT NULL,
  "reason" text,
  "changed_by" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "lot_cadence_changes"
    ADD CONSTRAINT "lot_cadence_changes_lot_entry_id_lot_entries_id_fk"
    FOREIGN KEY ("lot_entry_id") REFERENCES "public"."lot_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "lot_cadence_changes"
    ADD CONSTRAINT "lot_cadence_changes_changed_by_users_id_fk"
    FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_lot_cadence_changes_lot" ON "lot_cadence_changes" USING btree ("lot_entry_id");
