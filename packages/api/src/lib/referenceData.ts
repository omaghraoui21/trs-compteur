// ════════════════════════════════════════════════════════════════════
// Shared reference (seed) data — SINGLE SOURCE OF TRUTH.
//
// Consumed by BOTH seeders so they can never drift:
//   - lib/seed.ts      → seedIfEmpty(), runs at server boot + in tests
//   - scripts/seed.ts  → `pnpm db:seed`, the manual CLI seeder
//
// Pure data only (no DB import) so it stays trivially testable and portable.
// ════════════════════════════════════════════════════════════════════

export const roomData = [
  { code: "LOCAL-BLI", name: "Local Blistereuse", description: "Salle de conditionnement sous blisters" },
  { code: "LOCAL-GEL", name: "Local Géluleuse", description: "Salle de remplissage gélules" },
];

export const equipmentData = [
  { roomCode: "LOCAL-BLI", code: "BLI-IMA-TR135S", name: "Blistereuse IMA TR135S", equipmentType: "blistereuse", trsObjective: "75", defaultCadenceUnit: "u/min" },
  { roomCode: "LOCAL-GEL", code: "GEL-HH-MODUC", name: "Géluleuse Harro Höfliger Modu-C", equipmentType: "geluleuse", trsObjective: "75", defaultCadenceUnit: "u/min" },
];

export const productData = [
  { code: "AEROFOR-12", name: "Aerofor 12µg", defaultCadence: "100", cadenceUnit: "u/min", unit: "blisters" },
  { code: "AERONIDE-200", name: "Aeronide 200µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
  { code: "AERONIDE-400", name: "Aeronide 400µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
  { code: "COMBIFOR-12-200", name: "Combifor 12/200µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
  { code: "COMBIFOR-12-400", name: "Combifor 12/400µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
];

// Cadence per product × equipment, keyed by equipment code.
// Blistereuse varies by product; Géluleuse runs all at 1020 u/min.
export const cadenceData = [
  { productCode: "AEROFOR-12", equipmentCode: "BLI-IMA-TR135S", cadence: "100", unit: "u/min" },
  { productCode: "AERONIDE-200", equipmentCode: "BLI-IMA-TR135S", cadence: "120", unit: "u/min" },
  { productCode: "AERONIDE-400", equipmentCode: "BLI-IMA-TR135S", cadence: "120", unit: "u/min" },
  { productCode: "COMBIFOR-12-200", equipmentCode: "BLI-IMA-TR135S", cadence: "107", unit: "u/min" },
  { productCode: "COMBIFOR-12-400", equipmentCode: "BLI-IMA-TR135S", cadence: "50", unit: "u/min" },
  { productCode: "AEROFOR-12", equipmentCode: "GEL-HH-MODUC", cadence: "1020", unit: "u/min" },
  { productCode: "AERONIDE-200", equipmentCode: "GEL-HH-MODUC", cadence: "1020", unit: "u/min" },
  { productCode: "AERONIDE-400", equipmentCode: "GEL-HH-MODUC", cadence: "1020", unit: "u/min" },
  { productCode: "COMBIFOR-12-200", equipmentCode: "GEL-HH-MODUC", cadence: "1020", unit: "u/min" },
  { productCode: "COMBIFOR-12-400", equipmentCode: "GEL-HH-MODUC", cadence: "1020", unit: "u/min" },
];

// ── Reason codes (downtime categories) ──────────────────────────────
// `isPlanned` drives the Planifié / Non planifié split end-to-end.
// `appliesToEquipmentType`: null = both machines.
export interface DowntimeCategorySeed {
  code: string;
  label: string;
  famille: string;
  isPlanned: boolean;
  appliesToEquipmentType: string | null;
}

export const downtimeCategoryData: DowntimeCategorySeed[] = [
  // ── NON PLANIFIÉ ──────────────────────────────────────────────────
  // Panne équipement (Blistereuse AB- / Géluleuse AG-)
  { code: "AB-BOUCHAGE", label: "Bouchage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
  { code: "AB-FORMAGE", label: "Problème de formage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
  { code: "AB-DECOUPE", label: "Mauvaise découpe", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
  { code: "AB-SCELLAGE", label: "Problème de scellage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
  { code: "AB-ENCODEUR", label: "Anomalie encodeur", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
  { code: "AG-DOSAGE", label: "Problème de dosage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
  { code: "AG-FERMETURE", label: "Problème fermeture gélules", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
  { code: "AG-ALIMENTATION", label: "Problème alimentation gélules", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
  // Intervention maintenance (corrective / DI = non planifié)
  { code: "IM-CORRECTIVE", label: "Maintenance corrective", famille: "Intervention maintenance", isPlanned: false, appliesToEquipmentType: null },
  { code: "IM-DI", label: "Demande d'intervention (DI)", famille: "Intervention maintenance", isPlanned: false, appliesToEquipmentType: null },
  // Attente & transition
  { code: "AI-MATIERE", label: "Attente matière/article", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
  { code: "AI-PERSONNEL", label: "Absence/manque effectif", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
  { code: "AI-VALIDATION", label: "Attente validation CQ", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
  { code: "AI-LIBERATION", label: "Libération AC", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
  { code: "AI-SAGE", label: "Problème connexion SAGE", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
  { code: "AI-TEST", label: "Test machinabilité", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
  // Utilités & environnement
  { code: "UE-PURIFIEE", label: "Eau purifiée", famille: "Utilités", isPlanned: false, appliesToEquipmentType: null },
  { code: "UE-AIR", label: "Air comprimé", famille: "Utilités", isPlanned: false, appliesToEquipmentType: null },
  { code: "UE-HVAC", label: "HVAC/Climatisation", famille: "Utilités", isPlanned: false, appliesToEquipmentType: null },
  // Contrôle qualité
  { code: "CQ-IPC", label: "Contrôle en cours (IPC)", famille: "Contrôle qualité", isPlanned: false, appliesToEquipmentType: null },
  { code: "CQ-RESERVE", label: "Réserve conditionnement secondaire", famille: "Contrôle qualité", isPlanned: false, appliesToEquipmentType: null },
  { code: "CQ-RECONDITIONNEMENT", label: "Reconditionnement", famille: "Contrôle qualité", isPlanned: false, appliesToEquipmentType: null },

  // ── PLANIFIÉ (alimente tAP) ───────────────────────────────────────
  { code: "IM-PREVENTIVE", label: "Maintenance préventive", famille: "Intervention maintenance", isPlanned: true, appliesToEquipmentType: null },
  // ex-phases nettoyage (fusionnées dans les arrêts planifiés)
  { code: "AP-NETT-PARTIEL", label: "Nettoyage planifié partiel", famille: "Nettoyage planifié", isPlanned: true, appliesToEquipmentType: null },
  { code: "AP-NETT-COMPLET", label: "Nettoyage planifié complet", famille: "Nettoyage planifié", isPlanned: true, appliesToEquipmentType: null },
  { code: "AP-VIDE-LIGNE", label: "Vide de ligne", famille: "Nettoyage planifié", isPlanned: true, appliesToEquipmentType: null },
  // ex-phases changement de série
  { code: "CH-CHSB", label: "Changement de série (CHSB)", famille: "Changement de série", isPlanned: true, appliesToEquipmentType: "blistereuse" },
  { code: "CH-CHSG", label: "Changement de série (CHSG)", famille: "Changement de série", isPlanned: true, appliesToEquipmentType: "geluleuse" },
  { code: "CH-FORMAT", label: "Changement de format", famille: "Changement de série", isPlanned: true, appliesToEquipmentType: null },
  // ex-phases arrêt planifié
  { code: "AP-PAUSE", label: "Pause réglementaire", famille: "Arrêt planifié", isPlanned: true, appliesToEquipmentType: null },
  { code: "AP-APR", label: "Arrêt programmé réglementaire (APR)", famille: "Arrêt planifié", isPlanned: true, appliesToEquipmentType: null },
];
