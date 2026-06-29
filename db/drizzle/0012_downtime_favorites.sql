-- Favourite quick-stops: admin can mark up to 4 downtime categories as
-- favourites, surfaced on the operator main screen as one-tap chrono buttons.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-run on a DB that
-- was bootstrapped via db:push.

ALTER TABLE "downtime_categories" ADD COLUMN IF NOT EXISTS "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "downtime_categories" ADD COLUMN IF NOT EXISTS "favorite_order" integer;
