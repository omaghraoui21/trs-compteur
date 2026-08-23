#!/usr/bin/env node
// Guard against the dual migration-directory trap.
//
// `packages/db/drizzle` is the dev/source dir (drizzle-kit writes here);
// `db/drizzle` is what the runtime migrator reads (build-api.mjs copies into it).
// If a developer edits one and forgets the other, production migrations drift
// from what tests/dev validated — the highest-consequence kind of skew.
//
// This script fails CI when the migration SQL files or the journal differ
// between the two directories. Fix by re-running `node scripts/build-api.mjs`
// (or copying the new migration into both) so they match.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = join(root, "db", "drizzle");
const B = join(root, "packages", "db", "drizzle");

const sqlFiles = (d) =>
  existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".sql")).sort() : [];
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

const problems = [];

// 1. Same set of .sql migration files.
const aFiles = sqlFiles(A);
const bFiles = sqlFiles(B);
const aSet = new Set(aFiles);
const bSet = new Set(bFiles);
for (const f of aFiles) if (!bSet.has(f)) problems.push(`Only in db/drizzle: ${f}`);
for (const f of bFiles) if (!aSet.has(f)) problems.push(`Only in packages/db/drizzle: ${f}`);

// 2. Identical contents for the files present in both.
for (const f of aFiles) {
  if (!bSet.has(f)) continue;
  if (read(join(A, f)) !== read(join(B, f))) problems.push(`Content differs: ${f}`);
}

// 3. Journals match.
const ja = read(join(A, "meta", "_journal.json"));
const jb = read(join(B, "meta", "_journal.json"));
if (ja !== jb) problems.push("meta/_journal.json differs between the two dirs");

if (problems.length) {
  console.error("✗ Migration directories are out of sync:\n  - " + problems.join("\n  - "));
  console.error("\nFix: run `node scripts/build-api.mjs` (copies packages/db/drizzle → db/drizzle), then commit both.");
  process.exit(1);
}
console.log(`✓ Migrations in sync (${aFiles.length} files) across db/drizzle and packages/db/drizzle.`);
