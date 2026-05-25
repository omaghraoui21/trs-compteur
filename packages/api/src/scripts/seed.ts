import "dotenv/config";
import bcrypt from "bcryptjs";
import { createDb, rooms, equipments, products, users, downtimeCategories, productEquipmentCadences } from "@trs/db";

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
  let eqBli: { id: string } | undefined;
  let eqGel: { id: string } | undefined;

  if (roomBli) {
    const [row] = await db.insert(equipments).values({
      roomId: roomBli.id,
      code: "BLI-IMA-TR135S",
      name: "Blistereuse IMA TR135S",
      equipmentType: "blistereuse",
      trsObjective: "75",
      defaultCadenceUnit: "u/min",
    }).onConflictDoNothing().returning();
    eqBli = row;
  }

  if (roomGel) {
    const [row] = await db.insert(equipments).values({
      roomId: roomGel.id,
      code: "GEL-HH-MODUC",
      name: "Géluleuse Harro Höfliger Modu-C",
      equipmentType: "geluleuse",
      trsObjective: "75",
      defaultCadenceUnit: "u/min",
    }).onConflictDoNothing().returning();
    eqGel = row;
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

  const insertedProducts: Record<string, string> = {};
  for (const p of productData) {
    const [row] = await db.insert(products).values(p).onConflictDoNothing().returning();
    if (row) insertedProducts[p.code] = row.id;
  }

  console.log("  ✓ Products created (5)");

  // ─── Product × Equipment Cadences ──────────────────────
  // Cadences from Excel: Blistereuse varies by product, Géluleuse = 1020 u/min for all
  const cadenceData: { productCode: string; eqId: string | undefined; cadence: string; unit: string }[] = [
    { productCode: "AEROFOR-12", eqId: eqBli?.id, cadence: "100", unit: "u/min" },
    { productCode: "AERONIDE-200", eqId: eqBli?.id, cadence: "120", unit: "u/min" },
    { productCode: "AERONIDE-400", eqId: eqBli?.id, cadence: "120", unit: "u/min" },
    { productCode: "COMBIFOR-12-200", eqId: eqBli?.id, cadence: "107", unit: "u/min" },
    { productCode: "COMBIFOR-12-400", eqId: eqBli?.id, cadence: "50", unit: "u/min" },
    // Géluleuse: all products at 1020 u/min
    { productCode: "AEROFOR-12", eqId: eqGel?.id, cadence: "1020", unit: "u/min" },
    { productCode: "AERONIDE-200", eqId: eqGel?.id, cadence: "1020", unit: "u/min" },
    { productCode: "AERONIDE-400", eqId: eqGel?.id, cadence: "1020", unit: "u/min" },
    { productCode: "COMBIFOR-12-200", eqId: eqGel?.id, cadence: "1020", unit: "u/min" },
    { productCode: "COMBIFOR-12-400", eqId: eqGel?.id, cadence: "1020", unit: "u/min" },
  ];

  for (const c of cadenceData) {
    const productId = insertedProducts[c.productCode];
    if (productId && c.eqId) {
      await db.insert(productEquipmentCadences).values({
        productId, equipmentId: c.eqId,
        cadenceValue: c.cadence, cadenceUnit: c.unit,
      }).onConflictDoNothing();
    }
  }

  console.log("  ✓ Product×Equipment cadences created");

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
