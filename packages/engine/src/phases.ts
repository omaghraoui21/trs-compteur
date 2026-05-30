// Single source of truth for phase-template vocabulary, shared by the API
// (Zod validation), the admin config UI, and the operator phase picker. Lives
// in the dependency-free engine so both web and api import the same lists and
// they cannot drift. Colors stay frontend-only (see Compteur.tsx).

export const PHASE_CATEGORY_KEYS = ["production", "nettoyage", "changement", "arret_planifie"] as const;
export type PhaseCategory = (typeof PHASE_CATEGORY_KEYS)[number];

export const PHASE_CATEGORY_LABELS: Record<PhaseCategory, string> = {
  production: "Production",
  nettoyage: "Nettoyage",
  changement: "Changement de série",
  arret_planifie: "Arrêt planifié",
};

// Event types selectable when configuring a phase template — the full
// event_type enum minus the lot lifecycle types (lot_start / lot_end), which
// are recorded automatically and are not phases.
export const PHASE_EVENT_TYPES = [
  "remplissage", "nettoyage", "vide_ligne", "chsb", "chsg", "pause", "apr", "mqch", "custom",
] as const;
