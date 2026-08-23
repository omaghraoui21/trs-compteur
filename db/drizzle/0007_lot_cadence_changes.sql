-- Historique des changements de cadence en cours de lot (audit + cadence
-- moyenne pondérée). Strictement additif et idempotent.
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
  ALTER TABLE "lot_cadence_changes" ADD CONSTRAINT "lot_cadence_changes_lot_entry_id_lot_entries_id_fk"
    FOREIGN KEY ("lot_entry_id") REFERENCES "public"."lot_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lot_cadence_changes" ADD CONSTRAINT "lot_cadence_changes_changed_by_users_id_fk"
    FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lot_cadence_changes_lot" ON "lot_cadence_changes" USING btree ("lot_entry_id");
