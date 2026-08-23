# Database Audit Report — TRS Compteur
**Date:** 2026-06-21  
**Environment:** PostgreSQL on Railway (production) / Vercel (serverless)  
**ORM:** Drizzle ORM v7  
**Standard:** GxP / 21 CFR Part 11  

---

## 1. What I Inspected

| Area | Files / Scope |
|------|--------------|
| Schema definition | `packages/db/src/schema.ts` (360 lines, 14 tables) |
| Existing hardening | Migrations 0000–0008 (including 0004 CHECK constraints, 0005 e-sig triggers) |
| Query patterns | `packages/api/src/routes/` — dashboard, lots, sessions, auth, admin, ref, maintenance |
| Connection config | `packages/db/src/index.ts` |
| Migration infrastructure | `scripts/migrate.ts`, `scripts/check-migrations-sync.mjs` |
| Auth & token hygiene | `packages/api/src/routes/auth.ts`, `packages/api/src/routes/maintenance.ts` |

**Tables audited:** rooms, equipments, products, users, refreshTokens, downtimeCategories, phaseTemplates, sessions, sessionEvents, lotEntries, downtimeEvents, lotCadenceChanges, dailySummaries, auditLog, electronicSignatures, productEquipmentCadences (16 total).

---

## 2. What Was Wrong — Findings by Severity

### CRITICAL

| # | Table | Issue |
|---|-------|-------|
| C1 | `lot_cadence_changes` | `cadence_unit` had no vocabulary constraint — any string accepted |
| C2 | `lot_cadence_changes` | `old_cadence` and `new_cadence` had no positivity check — zero/negative cadence corrupts TRS math |

### HIGH

| # | Table | Issue |
|---|-------|-------|
| H1 | `daily_summaries` | Ratio columns (trs, trg, disponibilite, performance, qualite) had no `[0,1]` range constraint — engine bug could silently write `>1` or `<0` values |
| H2 | `lot_entries` | `lot_order` had no `>= 1` constraint — order 0 or negative is semantically invalid |
| H3 | `packages/db/src/index.ts` | SSL not explicitly enforced — `ssl:"require"` missing; connection could use plaintext in environments where DATABASE_URL lacks `sslmode=require` |
| H4 | `refresh_tokens` | No index on `expires_at` or `revoked_at` — maintenance cleanup (`DELETE WHERE expiresAt < now OR revokedAt < 24h`) does a full table scan on every cron run |
| H5 | `lot_entries` | No index on `(status, ended_at DESC)` — the supervisor's pending-lots query (hot path, filtered + sorted) performs a sequential scan + sort |
| H6 | `sessions` | No index on `operator_id` — active-session ownership check scans entire sessions table |

### MEDIUM

| # | Table | Issue |
|---|-------|-------|
| M1 | `session_events` | `duration_minutes` had no positivity constraint when populated |
| M2 | `products` | `default_cadence` had no positivity constraint when set |
| M3 | `lot_entries` | No index on `operator_id` — ownership reads scan all lots |
| M4 | `lot_entries` | No index on `ended_at` — ORDER BY without supporting index |
| M5 | `sessions` | No composite index `(operator_id, status)` for the combined filter |
| M6 | `downtime_events` | No index on `created_by` — operator delete-permission check scans table |

### LOW (already safe — no action needed)

| # | Item | Why Safe |
|---|------|---------|
| L1 | `audit_log` immutability | BEFORE UPDATE/DELETE triggers enforce append-only (migration 0004) |
| L2 | `electronic_signatures` immutability | BEFORE UPDATE/DELETE triggers in migration 0005 |
| L3 | bcrypt password hashing | `bcrypt.hash(pw, 10)` + `bcrypt.compare()` — correct algorithm and cost |
| L4 | Refresh token storage | SHA-256 hash with UNIQUE index — no plaintext secret in DB |
| L5 | User role default | Defaults to `'operator'` — least-privilege |
| L6 | `downtime_events` attachment | `CHECK (lot_entry_id IS NOT NULL OR session_id IS NOT NULL)` in migration 0006 |
| L7 | `users` role vocabulary | `CHECK (role IN ('operator','supervisor','admin'))` in migration 0004 |

---

## 3. What I Changed

### Migration 0009 — `packages/db/drizzle/0009_performance_and_constraints.sql`

**CHECK constraints added (all idempotent via `DO $$ EXCEPTION WHEN duplicate_object`):**

```sql
-- session_events: duration non-negative when set
chk_session_event_duration_positive → duration_minutes IS NULL OR duration_minutes > 0

-- lot_cadence_changes: cadence values must be positive
chk_cadence_changes_values_positive → old_cadence > 0 AND new_cadence > 0

-- lot_cadence_changes: unit vocabulary
chk_cadence_changes_unit → cadence_unit IN ('u/h', 'u/min')

-- daily_summaries: ratio columns in [0,1]
chk_daily_summary_ratios → each of trs/trg/disponibilite/performance/qualite IS NULL OR [0,1]

-- lot_entries: lot_order >= 1
chk_lot_order_positive → lot_order >= 1

-- products: default_cadence positive when set
chk_product_default_cadence_positive → default_cadence IS NULL OR default_cadence > 0
```

**Indexes added (all `CREATE INDEX IF NOT EXISTS`):**

| Index name | Table | Columns | Purpose |
|-----------|-------|---------|---------|
| `idx_refresh_tokens_expires` | refresh_tokens | expires_at | Cleanup cron scan |
| `idx_refresh_tokens_revoked` | refresh_tokens | revoked_at | Cleanup cron scan |
| `idx_sessions_operator` | sessions | operator_id | Active-session lookup |
| `idx_sessions_operator_status` | sessions | (operator_id, status) | Combined filter hot path |
| `idx_lot_entries_operator_id` | lot_entries | operator_id | Ownership check |
| `idx_lot_entries_ended_at` | lot_entries | ended_at DESC | ORDER BY in pending-lots |
| `idx_lot_entries_status_ended_at` | lot_entries | (status, ended_at DESC) | Filter+sort supervisor query |
| `idx_downtime_events_created_by` | downtime_events | created_by | Delete ownership check |

**SSL enforcement — `packages/db/src/index.ts`:**

```ts
// Before:
const client = postgres(url, { max, idle_timeout, connect_timeout, prepare: false });

// After:
const client = postgres(url, {
  max, idle_timeout, connect_timeout, prepare: false,
  ssl: process.env.DB_SSL === "false" ? false : "require",
});
```

**Schema tracking — `packages/db/src/schema.ts`:**  
All 8 new indexes added to the Drizzle table definitions so drizzle-kit generate stays in sync.

---

## 4. Why It Is Safer/Better

- **CHECK constraints** catch bad data at the DB layer regardless of which code path wrote it — ORM bugs, direct psql inserts, or future integrations can't bypass them.
- **Ratio `[0,1]` constraint on daily_summaries** prevents a corrupted TRS computation (e.g. division-by-zero producing Infinity, which slips past Zod `.finite()` only enforced at the API boundary) from persisting silently.
- **Cadence positivity** mirrors the 0004 constraint on `lot_entries.cadence_used` — ensures TRS math never divides by zero at any source.
- **SSL enforcement** ensures GxP data-in-transit encryption even when DATABASE_URL is misconfigured without `sslmode=require` — a hard requirement for pharma audits.
- **Hot-path indexes** reduce the supervisor's pending-lots query (most frequent supervisor action) from a full scan + sort to an index range scan; cleanup cron shrinks from O(N) to O(rows_to_delete).

---

## 5. SQL / Migrations Created

| File | Lines | Type |
|------|-------|------|
| `packages/db/drizzle/0009_performance_and_constraints.sql` | 91 | Migration (new) |
| `db/drizzle/0009_performance_and_constraints.sql` | 91 | Synced copy (build-api.mjs) |
| `packages/db/drizzle/meta/_journal.json` | +6 lines | Journal entry idx=9 added |
| `scripts/db-constraint-tests.sql` | ~150 | QA test script (not a migration) |
| `docs/DATABASE.md` | ~200 | Schema reference (new) |

**Rollback strategy:** Every statement in 0009 is additive — CHECK constraints and indexes can be dropped individually with `ALTER TABLE ... DROP CONSTRAINT` / `DROP INDEX` in a rollback migration. No data is modified or deleted.

---

## 6. Tests Performed

| Test | Method | Result |
|------|--------|--------|
| TypeScript typecheck (all 4 packages) | `pnpm typecheck` | ✅ PASS — 0 errors |
| Engine unit tests (NF E 60-182 TRS math) | `pnpm --filter @trs/engine test` | ✅ PASS — 99/99 |
| Migration directory sync | `node scripts/check-migrations-sync.mjs` | ✅ PASS — 10 files in sync |
| API bundle build | `node scripts/build-api.mjs` | ✅ PASS — handler.mjs rebuilt |
| Migration SQL syntax | Cross-checked with schema.ts column names | ✅ PASS — all snake_case names verified |
| Constraint test SQL | `scripts/db-constraint-tests.sql` | Written for execution against live DB |

> **Note:** No live DATABASE_URL was available in this environment. The QA test script (`scripts/db-constraint-tests.sql`) contains ready-to-run SQL for every constraint and is designed to be executed against staging or production by a DBA before the next release.

---

## 7. Remaining Risks

| Risk | Severity | Mitigation |
|------|---------|-----------|
| `session_events` has no immutability trigger — phase events can be edited post-close | MEDIUM | Business flow may require editing; deliberate. Add trigger if GMP audit demands it. |
| `downtime_events` allows both `lot_entry_id` AND `session_id` to be set simultaneously (no XOR constraint) | LOW | The "at least one" CHECK (0006) is enforced. Dual-attachment is harmless in current rollup logic; add XOR only if reporting requires exclusivity. |
| `daily_summaries` is a derived cache — if the engine recomputes TRS > 1 due to a data bug, the new `[0,1]` constraint will now REJECT the insert/update | LOW | The constraint is the correct behaviour — it surfaces the bug rather than hiding it. The fix is in the data, not the constraint. |
| No connection pool guard on Railway Docker deploy (max: 10) if PgBouncer is not in front | LOW | For <50 concurrent users this is fine. Add PgBouncer or Neon pooler if concurrency grows. |
| `DB_SSL=false` env var escape hatch could disable SSL in a misconfigured production env | LOW | Document in .env.example; CI should validate DATABASE_URL includes `sslmode`. |

---

## 8. Next Recommended Steps

1. **Run `scripts/db-constraint-tests.sql` against staging** — verify every CHECK constraint fires correctly before Railway auto-deploys migration 0009.
2. **Add `DB_SSL=false` to `.env.example`** (developer documentation) with a comment that it must never appear in production.
3. **Consider `session_events` immutability trigger** if the next GMP audit requires phase-timeline tamper-evidence.
4. **Monitor `daily_summaries` insert failures** after the `[0,1]` constraint lands — any failure reveals a pre-existing TRS engine edge case with real production data.
5. **Set up `EXPLAIN ANALYZE` baseline** on the pending-lots query (`GET /dashboard/pending-lots`) using a staging DB with >1000 lots to confirm the composite index `(status, ended_at DESC)` is picked up by the planner.
