import "dotenv/config";
import bcrypt from "bcryptjs";
import { createDb, users } from "@trs/db";
import { seedReferenceData } from "../lib/seed";
import { roomData, equipmentData, productData, downtimeCategoryData } from "../lib/referenceData";

const db = createDb();

async function seed() {
  console.log("🌱 Seeding TRS Compteur database...");

  // ─── Users ────────────────────────────────────────────
  const [passwordHash, superHash, adminHash] = await Promise.all([
    bcrypt.hash("oper123", 10), bcrypt.hash("super123", 10), bcrypt.hash("admin123", 10),
  ]);

  await db.insert(users).values([
    { email: "operateur@dpi.local", passwordHash, displayName: "Opérateur DPI", role: "operator" },
    { email: "superviseur@dpi.local", passwordHash: superHash, displayName: "Superviseur DPI", role: "supervisor" },
    { email: "admin@dpi.local", passwordHash: adminHash, displayName: "Admin DPI", role: "admin" },
  ]).onConflictDoNothing();
  console.log("  ✓ Users created");

  // ─── Reference data (single source of truth — see lib/referenceData.ts) ──
  // rooms, equipment, products, cadences, reason codes, legacy phase templates.
  await seedReferenceData(db);
  console.log(`  ✓ ${roomData.length} salles · ${equipmentData.length} équipements · ${productData.length} produits · ${downtimeCategoryData.length} catégories d'arrêt · phases`);

  console.log("\n✅ Seed complete!");
}

seed().catch(console.error).finally(() => process.exit(0));
