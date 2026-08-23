import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "@trs/db";

/**
 * Reset operational/transactional data for a fresh production launch.
 *
 * KEEPS all reference / configuration data (the "base"):
 *   rooms, equipments, products, users, downtime_categories,
 *   phase_templates, product_equipment_cadences.
 *
 * CLEARS all operational data produced by day-to-day use:
 *   sessions, session_events, lot_entries, downtime_events,
 *   lot_cadence_changes, daily_summaries, audit_log,
 *   electronic_signatures, refresh_tokens.
 *
 * Safety: DRY-RUN by default — it only prints row counts. Pass `--yes`
 * (or set CONFIRM_RESET=YES) to actually delete.
 *
 *   pnpm db:reset            # dry-run, shows what would be cleared
 *   pnpm db:reset -- --yes   # actually clears the operational tables
 *
 * ⚠ Irreversible. Take a backup first (the daily pg_dump CI, or
 *   `pg_dump "$DATABASE_URL" > backup.sql`) before running with --yes.
 */

// Order doesn't matter — TRUNCATE … CASCADE resolves FK dependencies — but
// listing them explicitly documents exactly what is wiped (no implicit cascade
// into a reference table, which would have no FK here anyway).
const OPERATIONAL_TABLES = [
  "electronic_signatures",
  "audit_log",
  "daily_summaries",
  "lot_cadence_changes",
  "downtime_events",
  "session_events",
  "lot_entries",
  "sessions",
  "refresh_tokens",
] as const;

async function counts(db: ReturnType<typeof createDb>) {
  const rows = await db.execute(sql`
    SELECT 'sessions' AS table, COUNT(*)::int AS n FROM sessions
    UNION ALL SELECT 'session_events', COUNT(*)::int FROM session_events
    UNION ALL SELECT 'lot_entries', COUNT(*)::int FROM lot_entries
    UNION ALL SELECT 'downtime_events', COUNT(*)::int FROM downtime_events
    UNION ALL SELECT 'lot_cadence_changes', COUNT(*)::int FROM lot_cadence_changes
    UNION ALL SELECT 'daily_summaries', COUNT(*)::int FROM daily_summaries
    UNION ALL SELECT 'audit_log', COUNT(*)::int FROM audit_log
    UNION ALL SELECT 'electronic_signatures', COUNT(*)::int FROM electronic_signatures
    UNION ALL SELECT 'refresh_tokens', COUNT(*)::int FROM refresh_tokens
  `);
  return rows as unknown as { table: string; n: number }[];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("FATAL: DATABASE_URL is not set — refusing to run.");
    process.exit(1);
  }

  const confirm = process.argv.includes("--yes") || process.env.CONFIRM_RESET === "YES";
  const db = createDb();

  const host = process.env.DATABASE_URL.replace(/.*@([^/:]+).*/, "$1");
  console.log(`\nTarget DB host: ${host}`);
  console.log("\nOperational rows currently present:");
  for (const { table, n } of await counts(db)) {
    console.log(`  ${table.padEnd(24)} ${n}`);
  }

  if (!confirm) {
    console.log("\n⚠ DRY-RUN — nothing was deleted.");
    console.log("  Reference data (rooms, equipments, products, users, cadences,");
    console.log("  downtime_categories, phase_templates) is always preserved.");
    console.log("\n  To actually clear the operational tables above, re-run with:");
    console.log("    pnpm db:reset -- --yes\n");
    process.exit(0);
  }

  const list = OPERATIONAL_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`));

  console.log("\n✓ Operational data cleared. Rows after reset:");
  for (const { table, n } of await counts(db)) {
    console.log(`  ${table.padEnd(24)} ${n}`);
  }
  console.log("\n✓ Base ready for the new launch (reference data preserved).\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
  });
