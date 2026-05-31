import bcrypt from "bcryptjs";
import type { Db } from "@trs/db";
import {
  users, rooms, equipments, products, downtimeCategories, productEquipmentCadences,
  phaseTemplates,
} from "@trs/db";
import {
  roomData, equipmentData, productData, cadenceData, downtimeCategoryData,
} from "./referenceData";

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

  await seedReferenceData(db);

  console.log(`[seed] ✓ Initial data loaded (3 users · ${roomData.length} salles · ${equipmentData.length} équipements · ${productData.length} produits · ${downtimeCategoryData.length} catégories)`);
  return true;
}

// Seeds the shared reference data (rooms, equipment, products, cadences,
// reason codes, legacy phase templates). Idempotent — safe on every boot.
// Used by both seedIfEmpty() and the CLI seeder so the two never drift.
export async function seedReferenceData(db: Db): Promise<void> {
  const roomIds: Record<string, string> = {};
  for (const r of roomData) {
    const [row] = await db.insert(rooms).values(r).onConflictDoNothing().returning();
    if (row) roomIds[r.code] = row.id;
  }

  const equipmentIds: Record<string, string> = {};
  for (const e of equipmentData) {
    const roomId = roomIds[e.roomCode];
    if (!roomId) continue;
    const [row] = await db.insert(equipments).values({
      roomId, code: e.code, name: e.name, equipmentType: e.equipmentType,
      trsObjective: e.trsObjective, defaultCadenceUnit: e.defaultCadenceUnit,
    }).onConflictDoNothing().returning();
    if (row) equipmentIds[e.code] = row.id;
  }

  const productIds: Record<string, string> = {};
  for (const p of productData) {
    const [row] = await db.insert(products).values(p).onConflictDoNothing().returning();
    if (row) productIds[p.code] = row.id;
  }

  for (const c of cadenceData) {
    const productId = productIds[c.productCode];
    const equipmentId = equipmentIds[c.equipmentCode];
    if (productId && equipmentId) {
      await db.insert(productEquipmentCadences).values({
        productId, equipmentId, cadenceValue: c.cadence, cadenceUnit: c.unit,
      }).onConflictDoNothing();
    }
  }

  for (const cat of downtimeCategoryData) {
    await db.insert(downtimeCategories).values(cat).onConflictDoNothing();
  }

  await seedPhaseTemplates(db);
}

// Legacy phase templates — DEPRECATED (the app no longer creates phases; every
// stop is now a downtime classified planned/unplanned). Kept idempotently so
// existing data and any transitional reads keep working. Safe to remove later.
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
