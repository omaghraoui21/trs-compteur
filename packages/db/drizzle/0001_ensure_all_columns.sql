-- Idempotent column additions for tables bootstrapped via db:push before these
-- columns were added to schema.ts. Each ADD COLUMN IF NOT EXISTS is a no-op
-- when the column already exists.

ALTER TABLE "equipments" ADD COLUMN IF NOT EXISTS "micro_stop_threshold_min" integer DEFAULT 5 NOT NULL;--> statement-breakpoint

ALTER TABLE "lot_entries" ADD COLUMN IF NOT EXISTS "lot_order" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lot_entries" ADD COLUMN IF NOT EXISTS "supervisor_comment" text;--> statement-breakpoint
ALTER TABLE "lot_entries" ADD COLUMN IF NOT EXISTS "validated_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "session_events" ADD COLUMN IF NOT EXISTS "label" text;--> statement-breakpoint
ALTER TABLE "session_events" ADD COLUMN IF NOT EXISTS "is_planned" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "session_events" ADD COLUMN IF NOT EXISTS "lot_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "session_events" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_events" ADD COLUMN IF NOT EXISTS "comment" text;
