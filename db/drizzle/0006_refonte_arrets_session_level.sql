-- Refonte « Arrêts » : un arrêt peut être rattaché à un LOT (pendant la
-- production) OU à la SESSION (inter-lots : changement de série, nettoyage,
-- attente). Migration strictement ADDITIVE et idempotente — aucune donnée
-- supprimée. (electronic_signatures / phase_templates existent déjà via 0003/0005,
-- donc on ne les recrée pas : on ne garde que le diff réel.)

-- lot_entry_id devient nullable (no-op si déjà nullable)
ALTER TABLE "downtime_events" ALTER COLUMN "lot_entry_id" DROP NOT NULL;--> statement-breakpoint

-- nouvelle colonne session_id (arrêts niveau session)
ALTER TABLE "downtime_events" ADD COLUMN IF NOT EXISTS "session_id" uuid;--> statement-breakpoint

-- FK session_id → sessions(id) ON DELETE CASCADE (ajoutée seulement si absente)
DO $$ BEGIN
  ALTER TABLE "downtime_events"
    ADD CONSTRAINT "downtime_events_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- au moins un rattachement (lot ou session) — garde l'intégrité du modèle
DO $$ BEGIN
  ALTER TABLE "downtime_events"
    ADD CONSTRAINT "downtime_events_lot_or_session"
    CHECK ("lot_entry_id" IS NOT NULL OR "session_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_downtime_events_session" ON "downtime_events" USING btree ("session_id");
