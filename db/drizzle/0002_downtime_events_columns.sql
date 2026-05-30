-- downtime_events was bootstrapped via db:push before these columns were added
-- to schema.ts. Migration 0000's CREATE TABLE IF NOT EXISTS was a no-op on the
-- already-existing table, so these columns were never created. A full
-- `select().from(downtimeEvents)` (session detail, lot downtimes) references the
-- missing columns and fails with a 500 ("Erreur serveur") → the operator sees
-- "Connexion serveur impossible" when selecting an equipment that has a session.
-- Each ADD COLUMN IF NOT EXISTS is a no-op when the column already exists.

ALTER TABLE "downtime_events" ADD COLUMN IF NOT EXISTS "status" "dt_status" DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD COLUMN IF NOT EXISTS "is_short_stop" boolean;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD COLUMN IF NOT EXISTS "comment" text;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD COLUMN IF NOT EXISTS "created_by" uuid;
