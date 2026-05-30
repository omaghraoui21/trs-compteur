-- Phase templates make the "Ajouter une phase" picker DB-driven and
-- equipment-specific (like downtime_categories), so Blistereuse and Géluleuse
-- each show their correct phases through a single UI. Idempotent: safe to
-- re-run because the table is created only if absent.

CREATE TABLE IF NOT EXISTS "phase_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "category" text NOT NULL,
  "event_type" "event_type" NOT NULL,
  "is_planned" boolean DEFAULT true NOT NULL,
  "requires_comment" boolean DEFAULT false NOT NULL,
  "applies_to_equipment_type" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "phase_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint

-- Seed default phase templates (idempotent via ON CONFLICT). Planned stops,
-- cleanings and changeovers live here as session phases; unplanned stops stay
-- in downtime_categories because they must be linked to a lot to affect tF.
INSERT INTO "phase_templates"
  ("code", "label", "category", "event_type", "is_planned", "requires_comment", "applies_to_equipment_type", "sort_order")
VALUES
  ('PH-REMPLISSAGE',   'Remplissage',          'production',      'remplissage', true,  false, NULL,          10),
  ('PH-BLISTERING',    'Blistering',           'production',      'custom',      true,  false, 'blistereuse', 20),
  ('PH-CONDITIONNEMENT','Conditionnement',     'production',      'custom',      true,  false, NULL,          30),
  ('PH-IPC',           'Contrôle IPC',         'production',      'custom',      true,  false, NULL,          40),
  ('PH-NETT-PARTIEL',  'Nettoyage partiel',    'nettoyage',       'custom',      true,  false, NULL,          10),
  ('PH-NETT-COMPLET',  'Nettoyage complet',    'nettoyage',       'nettoyage',   true,  false, NULL,          20),
  ('PH-VIDE-LIGNE',    'Vide de ligne',        'nettoyage',       'vide_ligne',  true,  false, NULL,          30),
  ('PH-CHSB',          'CHSB — Changement série', 'changement',   'chsb',        true,  false, 'blistereuse', 10),
  ('PH-CHSG',          'CHSG — Changement série', 'changement',   'chsg',        true,  false, 'geluleuse',   20),
  ('PH-FORMAT',        'Changement de format', 'changement',      'custom',      true,  false, NULL,          30),
  ('PH-PAUSE',         'Pause',                'arret_planifie',  'pause',       true,  false, NULL,          10),
  ('PH-APR',           'APR — Arrêt programmé', 'arret_planifie', 'apr',         true,  true,  NULL,          20)
ON CONFLICT ("code") DO NOTHING;

