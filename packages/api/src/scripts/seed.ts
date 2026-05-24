import "dotenv/config";
import bcrypt from "bcryptjs";
import { createDb, rooms, equipments, products, users, downtimeCategories } from "@trs/db";

const db = createDb();

async function seed() {
  console.log("🌱 Seeding TRS Compteur database...");

  // ─── Users ────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("oper123", 10);
  const superHash = await bcrypt.hash("super123", 10);
  const adminHash = await bcrypt.hash("admin123", 10);

  const [operator] = await db.insert(users).values({
    email: "operateur@dpi.local",
    passwordHash,
    displayName: "Opérateur DPI",
    role: "operator",
  }).onConflictDoNothing().returning();

  const [supervisor] = await db.insert(users).values({
    email: "superviseur@dpi.local",
    passwordHash: superHash,
    displayName: "Superviseur DPI",
    role: "supervisor",
  }).onConflictDoNothing().returning();

  await db.insert(users).values({
    email: "admin@dpi.local",
    passwordHash: adminHash,
    displayName: "Admin DPI",
    role: "admin",
  }).onConflictDoNothing();

  console.log("  ✓ Users created");

  // ─── Rooms ────────────────────────────────────────────
  const [roomBli] = await db.insert(rooms).values({
    code: "LOCAL-BLI",
    name: "Local Blistereuse",
    description: "Salle de conditionnement sous blisters",
  }).onConflictDoNothing().returning();

  const [roomGel] = await db.insert(rooms).values({
    code: "LOCAL-GEL",
    name: "Local Géluleuse",
    description: "Salle de remplissage gélules",
  }).onConflictDoNothing().returning();

  console.log("  ✓ Rooms created");

  // ─── Equipments ───────────────────────────────────────
  if (roomBli) {
    await db.insert(equipments).values({
      roomId: roomBli.id,
      code: "BLI-IMA-TR135S",
      name: "Blistereuse IMA TR135S",
      equipmentType: "blistereuse",
      trsObjective: "75",
      defaultCadenceUnit: "u/min",
    }).onConflictDoNothing();
  }

  if (roomGel) {
    await db.insert(equipments).values({
      roomId: roomGel.id,
      code: "GEL-HH-MODUC",
      name: "Géluleuse Harro Höfliger Modu-C",
      equipmentType: "geluleuse",
      trsObjective: "75",
      defaultCadenceUnit: "u/min",
    }).onConflictDoNothing();
  }

  console.log("  ✓ Equipments created");

  // ─── Products ─────────────────────────────────────────
  const productData = [
    { code: "AEROFOR-12", name: "Aerofor 12µg", defaultCadence: "100", cadenceUnit: "u/min", unit: "blisters" },
    { code: "AERONIDE-200", name: "Aeronide 200µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
    { code: "AERONIDE-400", name: "Aeronide 400µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
    { code: "COMBIFOR-12-200", name: "Combifor 12/200µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
    { code: "COMBIFOR-12-400", name: "Combifor 12/400µg", defaultCadence: "120", cadenceUnit: "u/min", unit: "blisters" },
  ];

  for (const p of productData) {
    await db.insert(products).values(p).onConflictDoNothing();
  }

  console.log("  ✓ Products created (5)");

  // ─── Downtime Categories ──────────────────────────────
  const categories = [
    // Panne équipement (AB/AG)
    { code: "AB-BOUCHAGE", label: "Bouchage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-FORMAGE", label: "Problème de formage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-DECOUPE", label: "Mauvaise découpe", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-SCELLAGE", label: "Problème de scellage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AB-ENCODEUR", label: "Anomalie encodeur", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "blistereuse" },
    { code: "AG-DOSAGE", label: "Problème de dosage", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
    { code: "AG-FERMETURE", label: "Problème fermeture gélules", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },
    { code: "AG-ALIMENTATION", label: "Problème alimentation gélules", famille: "Panne équipement", isPlanned: false, appliesToEquipmentType: "geluleuse" },

    // Intervention maintenance (IM)
    { code: "IM-PREVENTIVE", label: "Maintenance préventive", famille: "Intervention maintenance", isPlanned: false },
    { code: "IM-CORRECTIVE", label: "Maintenance corrective", famille: "Intervention maintenance", isPlanned: false },
    { code: "IM-DI", label: "Demande d'intervention (DI)", famille: "Intervention maintenance", isPlanned: false },

    // Attente & transition (AI)
    { code: "AI-MATIERE", label: "Attente matière/article", famille: "Attente et transition", isPlanned: false },
    { code: "AI-PERSONNEL", label: "Absence/manque effectif", famille: "Attente et transition", isPlanned: false },
    { code: "AI-VALIDATION", label: "Attente validation CQ", famille: "Attente et transition", isPlanned: false },
    { code: "AI-LIBERATION", label: "Libération AC", famille: "Attente et transition", isPlanned: false },
    { code: "AI-SAGE", label: "Problème connexion SAGE", famille: "Attente et transition", isPlanned: false },
    { code: "AI-TEST", label: "Test machinabilité", famille: "Attente et transition", isPlanned: false },

    // Utilités & environnement
    { code: "UE-PURIFIEE", label: "Eau purifiée", famille: "Utilités", isPlanned: false },
    { code: "UE-AIR", label: "Air comprimé", famille: "Utilités", isPlanned: false },
    { code: "UE-HVAC", label: "HVAC/Climatisation", famille: "Utilités", isPlanned: false },

    // Contrôle qualité
    { code: "CQ-IPC", label: "Contrôle en cours (IPC)", famille: "Contrôle qualité", isPlanned: false },
    { code: "CQ-RESERVE", label: "Réserve conditionnement secondaire", famille: "Contrôle qualité", isPlanned: false },
    { code: "CQ-RECONDITIONNEMENT", label: "Reconditionnement", famille: "Contrôle qualité", isPlanned: false },
  ];

  for (const cat of categories) {
    await db.insert(downtimeCategories).values({
      ...cat,
      appliesToEquipmentType: cat.appliesToEquipmentType ?? null,
    }).onConflictDoNothing();
  }

  console.log(`  ✓ Downtime categories created (${categories.length})`);
  console.log("\n✅ Seed complete!");
}

seed().catch(console.error).finally(() => process.exit(0));
