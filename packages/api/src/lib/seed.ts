import bcrypt from "bcryptjs";
import type { Db } from "@trs/db";
import {
  users, rooms, equipments, products, downtimeCategories, productEquipmentCadences,
  phaseTemplates,
} from "@trs/db";

export async function seedIfEmpty(db: Db): Promise<boolean> {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) return false;

  console.log("[seed] Seeding initial data…");

  const [opHash, supHash, admHash] = await Promise.all([
    bcrypt.hash("oper123", 10), bcrypt.hash("super123", 10), bcrypt.hash("admin123", 10),
  ]);

  await db.insert(users).values([
    { email: "operateur@dpi.local", passwordHash: opHash, displayName: "Opérateur DPI", role: "operator" },
    { email: "superviseur@dpi.local", passwordHash: supHash, displayName: "Superviseur DPI", role: "supervisor" },
    { email: "admin@dpi.local", passwordHash: admHash, displayName: "Admin DPI", role: "admin" },
  ]).onConflictDoNothing();

  const [roomBli] = await db.insert(rooms).values({
    code: "LOCAL-BLI", name: "Local Blistereuse", description: "Salle de conditionnement sous blisters",
  }).onConflictDoNothing().returning();

  const [roomGel] = await db.insert(rooms).values({
    code: "LOCAL-GEL", name: "Local Géluleuse", description: "Salle de remplissage gélules",
  }).onConflictDoNothing().returning();

  let eqBliId: string | undefined;
  let eqGelId: string | undefined;

  if (roomBli) {
    const [r] = await db.insert(equipments).values({
      roomId: roomBli.id, code: "BLI-IMA-TR135S", name: "Blistereuse IMA TR135S",
      equipmentType: "blistereuse", trsObjective: "75", defaultCadenceUnit: "u/min",
    }).onConflictDoNothing().returning();
    eqBliId = r?.id;
  }
  if (roomGel) {
    const [r] = await db.insert(equipments).values({
      roomId: roomGel.id, code: "GEL-HH-MODUC", name: "Géluleuse Harro Höfliger Modu-C",
      equipmentType: "geluleuse", trsObjective: "75", defaultCadenceUnit: "u/min",
    }).onConflictDoNothing().returning();
    eqGelId = r?.id;
  }

  const productData = [
    { code: "AEROFOR-12", name: "Aerofor 12µg", defaultCadence: "100", cadenceUnit: "u/min", unit: "blisters" },
    { code: "AERONIDE-200", name: "Aeronide 200µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
    { code: "AERONIDE-400", name: "Aeronide 400µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
    { code: "COMBIFOR-12-200", name: "Combifor 12/200µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
    { code: "COMBIFOR-12-400", name: "Combifor 12/400µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
  ];
  const insertedIds: Record<string, string> = {};
  for (const p of productData) {
    const [r] = await db.insert(products).values(p).onConflictDoNothing().returning();
    if (r) insertedIds[p.code] = r.id;
  }

  const cadences: { productCode: string; eqId?: string; cadence: string }[] = [
    { productCode: "AEROFOR-12", eqId: eqBliId, cadence: "100" },
    { productCode: "AERONIDE-200", eqId: eqBliId, cadence: "120" },
    { productCode: "AERONIDE-400", eqId: eqBliId, cadence: "120" },
    { productCode: "COMBIFOR-12-200", eqId: eqBliId, cadence: "107" },
    { productCode: "COMBIFOR-12-400", eqId: eqBliId, cadence: "50" },
    { productCode: "AEROFOR-12", eqId: eqGelId, cadence: "1020" },
    { productCode: "AERONIDE-200", eqId: eqGelId, cadence: "1020" },
    { productCode: "AERONIDE-400", eqId: eqGelId, cadence: "1020" },
    { productCode: "COMBIFOR-12-200", eqId: eqGelId, cadence: "1020" },
    { productCode: "COMBIFOR-12-400", eqId: eqGelId, cadence: "1020" },
  ];
  for (const c of cadences) {
    const productId = insertedIds[c.productCode];
    if (productId && c.eqId) {
      await db.insert(productEquipmentCadences).values({
        productId, equipmentId: c.eqId, cadenceValue: c.cadence, cadenceUnit: "u/min",
      }).onConflictDoNothing();
    }
  }

  const categories = [
    { code: "AB-BOUCHAGE", label: "Bouchage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-FORMAGE", label: "Problème de formage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-DECOUPE", label: "Mauvaise découpe", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-SCELLAGE", label: "Problème de scellage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-ENCODEUR", label: "Anomalie encodeur", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AG-DOSAGE", label: "Problème de dosage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
    { code: "AG-FERMETURE", label: "Problème fermeture gélules", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
    { code: "AG-ALIMENTATION", label: "Alimentation gélules", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
    { code: "IM-PREVENTIVE", label: "Maintenance préventive", famille: "Intervention maintenance", isPlanned: false, appliesToEquipmentType: null },
    { code: "IM-CORRECTIVE", label: "Maintenance corrective", famille: "Intervention maintenance", isPlanned: false, appliesToEquipmentType: null },
    { code: "IM-DI", label: "Demande d'intervention (DI)", famille: "Intervention maintenance", isPlanned: false, appliesToEquipmentType: null },
    { code: "AI-MATIERE", label: "Attente matière/article", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
    { code: "AI-PERSONNEL", label: "Absence/manque effectif", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
    { code: "AI-VALIDATION", label: "Attente validation CQ", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
    { code: "AI-LIBERATION", label: "Libération AC", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
    { code: "AI-SAGE", label: "Problème connexion SAGE", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
    { code: "AI-TEST", label: "Test machinabilité", famille: "Attente et transition", isPlanned: false, appliesToEquipmentType: null },
    { code: "UE-PURIFIEE", label: "Eau purifiée", famille: "Utilités", isPlanned: false, appliesToEquipmentType: null },
    { code: "UE-AIR", label: "Air comprimé", famille: "Utilités", isPlanned: false, appliesToEquipmentType: null },
    { code: "UE-HVAC", label: "HVAC/Climatisation", famille: "Utilités", isPlanned: false, appliesToEquipmentType: null },
    { code: "CQ-IPC", label: "Contrôle en cours (IPC)", famille: "Contrôle qualité", isPlanned: false, appliesToEquipmentType: null },
    { code: "CQ-RESERVE", label: "Réserve conditionnement secondaire", famille: "Contrôle qualité", isPlanned: false, appliesToEquipmentType: null },
    { code: "CQ-RECONDITIONNEMENT", label: "Reconditionnement", famille: "Contrôle qualité", isPlanned: false, appliesToEquipmentType: null },
  ];
  for (const c of categories) {
    await db.insert(downtimeCategories).values(c).onConflictDoNothing();
  }

  await seedPhaseTemplates(db);

  console.log("[seed] ✓ Initial data loaded (3 users · 2 salles · 2 équipements · 5 produits · 23 catégories · 12 phases)");
  return true;
}

// Idempotent — safe to call on every boot. Mirrors the inserts in migration
// 0003 so fresh local DBs (created via `db:push`, which skips SQL migrations)
// also get the default phases.
export async function seedPhaseTemplates(db: Db): Promise<void> {
  const phases = [
    { code: "PH-REMPLISSAGE", label: "Remplissage", category: "production", eventType: "remplissage" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 10 },
    { code: "PH-BLISTERING", label: "Blistering", category: "production", eventType: "custom" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: "blistereuse", sortOrder: 20 },
    { code: "PH-CONDITIONNEMENT", label: "Conditionnement", category: "production", eventType: "custom" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 30 },
    { code: "PH-IPC", label: "Contrôle IPC", category: "production", eventType: "custom" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 40 },
    { code: "PH-NETT-PARTIEL", label: "Nettoyage partiel", category: "nettoyage", eventType: "custom" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 10 },
    { code: "PH-NETT-COMPLET", label: "Nettoyage complet", category: "nettoyage", eventType: "nettoyage" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 20 },
    { code: "PH-VIDE-LIGNE", label: "Vide de ligne", category: "nettoyage", eventType: "vide_ligne" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 30 },
    { code: "PH-CHSB", label: "CHSB — Changement série", category: "changement", eventType: "chsb" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: "blistereuse", sortOrder: 10 },
    { code: "PH-CHSG", label: "CHSG — Changement série", category: "changement", eventType: "chsg" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: "geluleuse", sortOrder: 20 },
    { code: "PH-FORMAT", label: "Changement de format", category: "changement", eventType: "custom" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 30 },
    { code: "PH-PAUSE", label: "Pause", category: "arret_planifie", eventType: "pause" as const, isPlanned: true, requiresComment: false, appliesToEquipmentType: null, sortOrder: 10 },
    { code: "PH-APR", label: "APR — Arrêt programmé", category: "arret_planifie", eventType: "apr" as const, isPlanned: true, requiresComment: true, appliesToEquipmentType: null, sortOrder: 20 },
  ];
  for (const p of phases) {
    await db.insert(phaseTemplates).values(p).onConflictDoNothing();
  }
}
