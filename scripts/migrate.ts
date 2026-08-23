import "dotenv/config";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@trs/db";
import { seedIfEmpty } from "../packages/api/src/lib/seed";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠ No DATABASE_URL — skipping migrations");
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const MIGRATIONS_DIR = path.resolve(__dirname, "../packages/db/drizzle");

  const db = createDb();
  if (existsSync(MIGRATIONS_DIR)) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log("✓ Migrations applied");
    await seedIfEmpty(db);
    console.log("✓ Seed checked");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
