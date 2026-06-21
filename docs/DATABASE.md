# Database Schema Reference

A comprehensive guide to the TRS Compteur pharmaceutical production tracking database. This system enforces GxP (Good manufacturing Practice) compliance via append-only audit logs, electronic signatures, and strict data integrity constraints.

---

## Tables

### Core Configuration

#### `rooms`
Manufacturing rooms/areas.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| code | text | ✗ | | Unique room code (e.g. "ROOM-A") |
| name | text | ✗ | | Display name |
| description | text | ✓ | | Optional notes |
| isActive | boolean | ✗ | true | Soft-delete flag |
| createdAt | timestamptz | ✗ | now() | Record creation timestamp |

**Indexes:** (code UNIQUE)

---

#### `equipments`
Production machinery (blistereuse, géluleuse, etc.).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| roomId | uuid | ✗ | | FK → rooms.id (NO ACTION) |
| code | text | ✗ | | Unique equipment code |
| name | text | ✗ | | Display name |
| equipmentType | text | ✓ | | 'blistereuse' or 'geluleuse' (CHECK: NULL \| in enum) |
| trsObjective | numeric(5,2) | ✗ | 75 | Target TRS % (CHECK: 0–100) |
| defaultCadenceUnit | text | ✗ | "u/h" | 'u/h' or 'u/min' (CHECK constraint) |
| microStopThresholdMin | integer | ✗ | 5 | Micro-stop duration threshold (minutes) |
| isActive | boolean | ✗ | true | Soft-delete flag |
| createdAt | timestamptz | ✗ | now() | |

**Constraints:**
- `chk_equip_type`: equipment_type IS NULL OR IN ('blistereuse', 'geluleuse')
- `chk_equip_cadence_unit`: default_cadence_unit IN ('u/h', 'u/min')
- `chk_equip_trs_objective`: trs_objective >= 0 AND <= 100

---

#### `products`
Manufactured products/medicines.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| code | text | ✗ | | Unique product code |
| name | text | ✗ | | Display name |
| defaultCadence | numeric(10,2) | ✓ | | Expected production rate (CHECK: > 0 if set) |
| cadenceUnit | text | ✗ | "u/h" | 'u/h' or 'u/min' (CHECK constraint) |
| unit | text | ✗ | "unités" | Display unit (e.g. "comprimés", "blisters") |
| isActive | boolean | ✗ | true | Soft-delete flag |
| createdAt | timestamptz | ✗ | now() | |

**Constraints:**
- `chk_product_cadence_unit`: cadence_unit IN ('u/h', 'u/min')
- `chk_product_default_cadence_positive`: default_cadence IS NULL OR default_cadence > 0

---

#### `users`
System users (operators, supervisors, admins).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| email | text | ✗ | | Unique email address |
| passwordHash | text | ✗ | | Bcrypt or similar; never stored plaintext |
| displayName | text | ✗ | | Human-readable name |
| role | text | ✗ | "operator" | 'operator', 'supervisor', or 'admin' (CHECK constraint) |
| isActive | boolean | ✗ | true | Soft-delete; users with audit records are deactivated, never deleted |
| createdAt | timestamptz | ✗ | now() | |

**Constraints:**
- `chk_user_role`: role IN ('operator', 'supervisor', 'admin')
- **Pharma Rule:** Users with audit_log records must never be physically deleted. Deactivate via `is_active=false`. actor_id FK uses ON DELETE NO ACTION to enforce this.

---

#### `refreshTokens`
JWT refresh token rotation with reuse detection (M2 pattern).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| userId | uuid | ✗ | | FK → users.id (CASCADE) |
| tokenHash | text | ✗ | | SHA256 hash of opaque token; never store plaintext |
| familyId | uuid | ✗ | | Links rotated tokens; revoked family = logout all devices |
| expiresAt | timestamptz | ✗ | | Token expiration time |
| revokedAt | timestamptz | ✓ | | When token was revoked/rotated; NULL = active |
| createdAt | timestamptz | ✗ | now() | |

**Indexes:** idx_refresh_tokens_hash, idx_refresh_tokens_family, idx_refresh_tokens_user, idx_refresh_tokens_expires, idx_refresh_tokens_revoked

**Token Rotation:** On refresh, create new token in same family, set old revokedAt. If client presents already-revoked token → revoke entire family (compromised session).

---

### Production & Sessions

#### `sessions`
Compteur Continu: continuous monitoring session for an equipment on a given date.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| equipmentId | uuid | ✗ | | FK → equipments.id (NO ACTION) |
| roomId | uuid | ✗ | | FK → rooms.id (NO ACTION); denormalized for query convenience |
| operatorId | uuid | ✗ | | FK → users.id (NO ACTION); session owner |
| sessionDate | date | ✗ | | Calendar date when session opened |
| openedAt | timestamptz | ✗ | now() | Precise opening timestamp |
| closedAt | timestamptz | ✓ | | Closed timestamp; NULL while active |
| status | session_status enum | ✗ | "active" | 'active' or 'closed'; machine: active→closed only |
| notes | text | ✓ | | Free-form session notes |
| createdAt | timestamptz | ✗ | now() | |
| updatedAt | timestamptz | ✗ | now() | Auto-updated on each row change |

**Indexes:** idx_sessions_date, idx_sessions_equipment, idx_sessions_equip_date, idx_sessions_status, idx_sessions_operator, idx_sessions_operator_status

**Status Machine:** `active` → `closed` (no reversals). Once closed, no new lots can be added.

---

#### `sessionEvents`
Timeline of phases (planned stops, cleanings, changeovers) within a session.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| sessionId | uuid | ✗ | | FK → sessions.id (CASCADE) |
| eventType | event_type enum | ✗ | | nettoyage, vide_ligne, remplissage, pause, chsb, chsg, apr, mqch, lot_start, lot_end, custom |
| label | text | ✓ | | Custom label (used when eventType='custom') |
| startedAt | timestamptz | ✗ | now() | When phase began |
| endedAt | timestamptz | ✓ | | When phase ended; NULL = ongoing |
| durationMinutes | integer | ✓ | | Calculated or manual duration (CHECK: NULL or > 0) |
| isPlanned | boolean | ✗ | true | True for cleaning/maintenance; false for unplanned |
| lotEntryId | uuid | ✓ | | FK → lotEntries.id (SET NULL); production phase links to a lot |
| sortOrder | integer | ✗ | 0 | Display order within session |
| comment | text | ✓ | | Phase notes |
| createdAt | timestamptz | ✗ | now() | |

**Constraints:**
- `chk_session_event_duration_positive`: duration_minutes IS NULL OR duration_minutes > 0

---

#### `lotEntries`
Production batch within a session. Core production record.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| sessionId | uuid | ✗ | | FK → sessions.id (CASCADE) |
| productId | uuid | ✗ | | FK → products.id (NO ACTION) |
| batchNumber | text | ✗ | | Batch/lot code (e.g. "LOT-2024-001") |
| lotOrder | integer | ✗ | 1 | Sequence within session (CHECK: >= 1) |
| cadenceUsed | numeric(10,2) | ✗ | | Actual production rate (CHECK: > 0) |
| cadenceUnit | text | ✗ | "u/h" | 'u/h' or 'u/min' (CHECK constraint) |
| quantityProduced | integer | ✗ | 0 | Total units produced (CHECK: >= 0) |
| quantityConforming | integer | ✗ | 0 | Units passing QC (CHECK: >= 0 and <= quantityProduced) |
| quantityRejected | integer | ✗ | 0 | Units failing QC (CHECK: >= 0) |
| startedAt | timestamptz | ✗ | now() | When production began |
| endedAt | timestamptz | ✓ | | When production ended; NULL = ongoing |
| status | lot_status enum | ✗ | "active" | active, closed, submitted, validated, rejected |
| operatorId | uuid | ✗ | | FK → users.id (NO ACTION); operator who ran the lot |
| supervisorId | uuid | ✓ | | FK → users.id (NO ACTION); supervisor QC sign-off |
| supervisorComment | text | ✓ | | QC review comment |
| validatedAt | timestamptz | ✓ | | When supervisor validated; NULL if rejected or pending |
| createdAt | timestamptz | ✗ | now() | |
| updatedAt | timestamptz | ✗ | now() | Auto-updated on change |

**Constraints:**
- `chk_lot_qty_non_negative`: all quantities >= 0
- `chk_lot_conforming_lte_produced`: quantity_conforming <= quantity_produced
- `chk_lot_cadence_positive`: cadence_used > 0
- `chk_lot_cadence_unit`: cadence_unit IN ('u/h', 'u/min')
- `chk_lot_order_positive`: lot_order >= 1

**Indexes:** idx_lot_entries_session, idx_lot_entries_product, idx_lot_entries_status, idx_lot_entries_date_batch, idx_lot_entries_operator_id, idx_lot_entries_ended_at, idx_lot_entries_status_ended_at

**Status Machine:**
```
active → closed (operator ends production)
closed → submitted (awaiting QC)
submitted → validated (supervisor approves + electronic signature required)
submitted → rejected (supervisor rejects + electronic signature)
```

---

#### `lotCadenceChanges`
Audit trail of in-lot cadence adjustments (consigne changes).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| lotEntryId | uuid | ✗ | | FK → lotEntries.id (CASCADE) |
| oldCadence | numeric(10,2) | ✗ | | Previous cadence (CHECK: > 0) |
| newCadence | numeric(10,2) | ✗ | | Updated cadence (CHECK: > 0) |
| cadenceUnit | text | ✗ | "u/min" | 'u/h' or 'u/min' (CHECK constraint) |
| reason | text | ✓ | | Why cadence was changed |
| changedBy | uuid | ✓ | | FK → users.id (NO ACTION) |
| changedAt | timestamptz | ✗ | now() | Timestamp of change |

**Constraints:**
- `chk_cadence_changes_values_positive`: old_cadence > 0 AND new_cadence > 0
- `chk_cadence_changes_unit`: cadence_unit IN ('u/h', 'u/min')

**Purpose:** Enables time-weighted nominal cadence calculation for TRS and audit trail of operator adjustments.

---

### Downtime & Stops

#### `downtimeCategories`
Reference table: stop categories (equipment failure, material waiting, adjustment, QC, cleaning, other).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| code | text | ✗ | | Unique category code |
| label | text | ✗ | | Display label (e.g. "Panne équipement") |
| famille | text | ✗ | | Family: Panne, Attente matière, Réglage, QC, Nettoyage, Autre |
| isPlanned | boolean | ✗ | false | True for scheduled maintenance; false for unplanned stops |
| appliesToEquipmentType | text | ✓ | | 'blistereuse', 'geluleuse', or NULL (both) |
| isActive | boolean | ✗ | true | Soft-delete flag |
| createdAt | timestamptz | ✗ | now() | |

---

#### `downtimeEvents`
Stop/downtime occurrence. Attached to a **lot** (during production) OR **session** (inter-lot).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| lotEntryId | uuid | ✓ | | FK → lotEntries.id (CASCADE); NULL for session-level stops |
| sessionId | uuid | ✓ | | FK → sessions.id (CASCADE); NULL for lot-level stops |
| categoryId | uuid | ✗ | | FK → downtimeCategories.id (NO ACTION) |
| startedAt | timestamptz | ✗ | now() | Stop begin time |
| endedAt | timestamptz | ✓ | | Stop end time; NULL = ongoing |
| durationMinutes | integer | ✗ | | Duration in minutes (CHECK: > 0) |
| status | dt_status enum | ✗ | "closed" | 'open' or 'closed' |
| isShortStop | boolean | ✓ | | NULL = auto-classify; true/false = explicit override |
| comment | text | ✓ | | Stop reason/notes |
| createdBy | uuid | ✓ | | FK → users.id (NO ACTION) |
| createdAt | timestamptz | ✗ | now() | Record creation |

**Constraints:**
- `chk_dt_duration_positive`: duration_minutes > 0
- `downtime_events_lot_or_session`: lot_entry_id IS NOT NULL OR session_id IS NOT NULL

**Indexes:** idx_downtime_events_lot, idx_downtime_events_session, idx_downtime_events_category, idx_downtime_events_created_by

**TRS Impact:** Lot-level stops affect tF (functioning time). Session-level stops (inter-lot) affect equipment availability. isShortStop=NULL auto-classifies based on equipment.microStopThresholdMin.

---

#### `phaseTemplates`
Database-driven configuration for session phase picker (production, cleaning, changeover, scheduled stops).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| code | text | ✗ | | Unique template code (e.g. "PH-CHSB") |
| label | text | ✗ | | Display label (e.g. "Changement série Blistereuse") |
| category | text | ✗ | | production, nettoyage, changement, or arret_planifie (CHECK constraint) |
| eventType | event_type enum | ✗ | | Corresponding session_events.event_type |
| isPlanned | boolean | ✗ | true | True for managed phases |
| requiresComment | boolean | ✗ | false | Operator must supply notes when creating this phase |
| appliesToEquipmentType | text | ✓ | | 'blistereuse', 'geluleuse', or NULL (both) |
| sortOrder | integer | ✗ | 0 | Display order in UI picker |
| isActive | boolean | ✗ | true | Soft-delete flag |
| createdAt | timestamptz | ✗ | now() | |

**Constraints:**
- `chk_phase_category`: category IN ('production', 'nettoyage', 'changement', 'arret_planifie')

**Note:** Blistereuse shows only blistereuse-specific phases (e.g. CHSB); Géluleuse shows only geluleuse-specific (e.g. CHSG). Null appliesToEquipmentType means phase applies to all.

---

#### `productEquipmentCadences`
Product-×-equipment cadence mapping for quick lookup.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| productId | uuid | ✗ | | FK → products.id (NO ACTION) |
| equipmentId | uuid | ✗ | | FK → equipments.id (NO ACTION) |
| cadenceValue | numeric(10,2) | ✗ | | Expected cadence (CHECK: > 0) |
| cadenceUnit | text | ✗ | "u/min" | 'u/h' or 'u/min' (CHECK constraint) |
| trsObjective | numeric(5,2) | ✓ | | Product-×-equipment TRS target override |
| createdAt | timestamptz | ✗ | now() | |
| updatedAt | timestamptz | ✗ | now() | |

**Constraints:**
- `uq_product_equipment_cadence`: UNIQUE(productId, equipmentId)

---

### Reporting

#### `dailySummaries`
Auto-generated summary of equipment performance for a given date. Pre-computed TRS metrics.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| equipmentId | uuid | ✗ | | FK → equipments.id (NO ACTION) |
| summaryDate | date | ✗ | | Calendar date |
| tOpeningMin | integer | ✗ | 0 | tO: opening time in minutes |
| tPlannedStopsMin | integer | ✗ | 0 | tAP: planned stops (maintenance, changeover) |
| tRequiredMin | integer | ✗ | 0 | tR = tO - tAP: required operating time |
| tUnplannedStopsMin | integer | ✗ | 0 | tAI: unplanned stops duration |
| tFunctioningMin | integer | ✗ | 0 | tF: actual functioning time |
| totalProduced | integer | ✗ | 0 | Total units produced across all lots |
| totalConforming | integer | ✗ | 0 | Total units passing QC |
| totalRejected | integer | ✗ | 0 | Total units failing QC |
| lotCount | integer | ✗ | 0 | Number of lots completed |
| trs | numeric(5,4) | ✓ | | TRS = (tF / tR) × (totalConforming / totalProduced); [0, 1] (CHECK) |
| trg | numeric(5,4) | ✓ | | Global equipment effectiveness (CHECK: [0, 1]) |
| disponibilite | numeric(5,4) | ✓ | | Availability = tF / tR (CHECK: [0, 1]) |
| performance | numeric(5,4) | ✓ | | Performance = (cadence achieved) / (cadence nominal) (CHECK: [0, 1]) |
| qualite | numeric(5,4) | ✓ | | Quality = totalConforming / totalProduced (CHECK: [0, 1]) |
| notes | text | ✓ | | Day summary notes |
| createdAt | timestamptz | ✗ | now() | |
| updatedAt | timestamptz | ✗ | now() | |

**Constraints:**
- `uq_daily_summary_equip_date`: UNIQUE(equipmentId, summaryDate)
- `chk_daily_summary_ratios`: all computed metrics in [0, 1] or NULL

**Purpose:** Prevents calculation bugs from silently writing invalid data (e.g. 150% availability).

---

### Audit & Compliance

#### `auditLog`
Append-only audit trail for regulatory compliance (GxP, pharma).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| actorId | uuid | ✓ | | FK → users.id (NO ACTION) |
| actorEmail | text | ✗ | | Denormalized email so record survives user changes |
| action | text | ✗ | | START_LOT, CLOSE_LOT, VALIDATE_LOT, REJECT_LOT, OPEN_SESSION, CLOSE_SESSION, etc. |
| entityType | text | ✗ | | lot, session, downtime, user, equipment, etc. |
| entityId | uuid | ✓ | | ID of affected entity |
| payload | text | ✓ | | JSON snapshot of entity (after-state or delta) |
| ipAddress | text | ✓ | | Client IP address |
| createdAt | timestamptz | ✗ | now() | Record timestamp (immutable) |

**Immutability:** Triggers prevent UPDATE and DELETE.

**Indexes:** idx_audit_log_actor, idx_audit_log_entity, idx_audit_log_created, idx_audit_log_action

**Pharma Rule:** Users with audit records must never be physically deleted. Deactivate via `is_active=false`. Corrections must insert new entries, never modify existing.

---

#### `electronicSignatures`
21 CFR Part 11 e-signature records for lot validation/rejection.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | ✗ | gen_random_uuid() | Primary Key |
| userId | uuid | ✓ | | FK → users.id (NO ACTION) |
| userEmail | text | ✗ | | Denormalized email for durability |
| userName | text | ✗ | | Denormalized display name |
| entityType | text | ✗ | | lot (currently; extensible) |
| entityId | uuid | ✗ | | Lot ID being signed |
| meaning | text | ✗ | | "Validation du lot" or "Rejet du lot" |
| action | text | ✗ | | validate or reject |
| comment | text | ✓ | | Signer comment on the decision |
| ipAddress | text | ✓ | | Client IP at signing |
| signedAt | timestamptz | ✗ | now() | Signature timestamp |

**Immutability:** Triggers prevent modification. A signature, once applied, is **immutable and permanent**.

**Requirement:** Supervisor must re-authenticate (password or MFA) to sign.

---

## Key Invariants (GxP/Pharma Rules)

### Append-Only Enforcement

Both audit_log and electronic_signatures have database-level triggers that reject UPDATE and DELETE. Corrections must be inserted as new rows. This ensures unbroken regulatory history.

### Status Machines

**Sessions:** `active` → `closed` (one-way). Once closed, no new lots can be added.

**Lots:**
```
active → closed → submitted → validated (+ e-signature)
                           ↘ rejected (+ e-signature)
```

### User Deletion Policy

Users with audit_log records are **deactivated** via `is_active=false`, never physically deleted. actor_id FK constraint ON DELETE NO ACTION enforces this. actorEmail is denormalized so the audit record survives user mutations.

### Data Integrity at DB Level

**Quantity Constraints on Lot:**
- All quantities >= 0
- quantity_conforming <= quantity_produced

**Cadence Constraints:**
- cadence_used > 0 (strict positive)
- cadenceUnit ∈ {'u/h', 'u/min'}

**TRS Ratio Constraints (daily_summaries):**
- trs, disponibilite, performance, qualite ∈ [0, 1] or NULL

**Downtime Attachment (downtime_events):**
- At least one of lot_entry_id or session_id must be set.

### Downtime Classification

**isShortStop behavior:**
- NULL (default): auto-classified as short stop if durationMinutes ≤ equipment.microStopThresholdMin → excluded from tAI.
- true/false: supervisor override (force inclusion or exclusion).

---

## Migration History

| File | One-Liner |
|------|-----------|
| 0000_mighty_madame_hydra.sql | Initial schema: all core tables + enums + FK + indexes. |
| 0001_ensure_all_columns.sql | Backfill: micro_stop_threshold_min, lot_order, supervisor_comment, validated_at for tables bootstrapped via db:push. |
| 0002_downtime_events_columns.sql | Backfill: status, is_short_stop, comment, created_by for downtime_events bootstrapped via db:push. |
| 0003_phase_templates.sql | New table: phase_templates (DB-driven session phase picker); seed 12 default phases. |
| 0004_db_hardening.sql | CHECK constraints: quantities, cadences, roles, units, TRS range; audit_log immutability triggers; session_events FK. |
| 0005_electronic_signatures.sql | New table: electronic_signatures (21 CFR Part 11); append-only immutability triggers. |
| 0006_refonte_arrets_session_level.sql | Downtime refactor: lot_entry_id nullable; new session_id column; FK + CHECK (at least one set). |
| 0007_lot_cadence_changes.sql | New table: lot_cadence_changes (audit trail of cadence adjustments); FK to lot_entries; index. |
| 0008_ensure_session_downtime_columns.sql | Idempotent safety: ensures session_id & lot_cadence_changes exist (Railway bootstrap fix). |
| 0009_performance_and_constraints.sql | Hardening pass 2: CHECK on session_event duration, lot_cadence_changes positivity, daily_summaries ratios, lot_order; missing indexes for hot paths. |

---

## Developer Notes

### Adding a New Migration

1. Make schema changes in `packages/db/src/schema.ts`.
2. Run `pnpm -F @trs/db drizzle-kit generate` to auto-generate the `.sql` file.
3. Review the SQL in `packages/db/drizzle/`:
   - Check for destructive operations (DROP, ALTER ... DROP).
   - Add idempotent guards (IF NOT EXISTS, DO $$ EXCEPTION $$) if bootstrapping.
   - Test locally.
4. Commit both schema.ts and .sql files.
5. Deploy: Migrations run automatically on `db:migrate` or `db:push`.

### Build & Deployment

**Dual-Directory Trap:**
- Development: migrations live in `packages/db/drizzle/`.
- Bundled deploy (Vercel): `scripts/build-api.mjs` copies `packages/db/drizzle/` → `db/drizzle/`.
- Server resolves MIGRATIONS_DIR relative to bundle location. Both directories must stay in sync.

```bash
# Before deploy, check:
diff -r packages/db/drizzle db/drizzle
```

### Local Docker Development

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/trs?sslmode=disable"
# or set DB_SSL=false
# Never use DB_SSL=false in production.
```

### Query Examples

**View applied migrations:**
```sql
SELECT * FROM __drizzle_migrations ORDER BY hash;
```

**Audit trail for a lot:**
```sql
SELECT actor_email, action, entity_type, payload, created_at
FROM audit_log
WHERE entity_type = 'lot' AND entity_id = '...'
ORDER BY created_at DESC;
```

**Electronic signatures for a lot:**
```sql
SELECT user_email, meaning, action, comment, signed_at
FROM electronic_signatures
WHERE entity_type = 'lot' AND entity_id = '...'
ORDER BY signed_at DESC;
```

**Active session for operator (uses composite index):**
```sql
SELECT s.* FROM sessions s
WHERE s.operator_id = '...' AND s.status = 'active'
ORDER BY s.opened_at DESC LIMIT 1;
```

---

## Performance Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| idx_audit_log_actor | audit_log | actor_id | Lookup audit entries by user |
| idx_audit_log_entity | audit_log | (entity_type, entity_id) | Lookup all changes to entity |
| idx_audit_log_created | audit_log | created_at | Time-range queries |
| idx_audit_log_action | audit_log | action | Filter by action type |
| idx_daily_summaries_date | daily_summaries | summary_date | Date range queries |
| idx_daily_summaries_equipment | daily_summaries | equipment_id | Equipment dashboard |
| idx_downtime_events_lot | downtime_events | lot_entry_id | Downtime list within lot |
| idx_downtime_events_session | downtime_events | session_id | Session-level stops |
| idx_downtime_events_category | downtime_events | category_id | Filter by category |
| idx_downtime_events_created_by | downtime_events | created_by | Operator ownership check |
| idx_esign_entity | electronic_signatures | (entity_type, entity_id) | Signature history for lot |
| idx_esign_user | electronic_signatures | user_id | User signature activity |
| idx_esign_signed | electronic_signatures | signed_at | Time-range queries |
| idx_lot_cadence_changes_lot | lot_cadence_changes | lot_entry_id | Cadence audit trail |
| idx_lot_entries_session | lot_entries | session_id | Lots in a session |
| idx_lot_entries_product | lot_entries | product_id | Product production history |
| idx_lot_entries_status | lot_entries | status | Filter by status |
| idx_lot_entries_date_batch | lot_entries | batch_number | Batch lookup |
| idx_lot_entries_operator_id | lot_entries | operator_id | Operator's lots |
| idx_lot_entries_ended_at | lot_entries | ended_at DESC | Pending-lots ORDER BY |
| idx_lot_entries_status_ended_at | lot_entries | (status, ended_at DESC) | Pending-lots WHERE + ORDER BY combo |
| idx_refresh_tokens_hash | refresh_tokens | token_hash | Token lookup |
| idx_refresh_tokens_family | refresh_tokens | family_id | Token rotation family |
| idx_refresh_tokens_user | refresh_tokens | user_id | User's tokens |
| idx_refresh_tokens_expires | refresh_tokens | expires_at | Cleanup expired tokens |
| idx_refresh_tokens_revoked | refresh_tokens | revoked_at | Cleanup revoked tokens |
| idx_session_events_session | session_events | session_id | Events in session |
| idx_session_events_type | session_events | event_type | Filter by phase type |
| idx_sessions_date | sessions | session_date | Date-based queries |
| idx_sessions_equipment | sessions | equipment_id | Equipment sessions |
| idx_sessions_equip_date | sessions | (equipment_id, session_date) | Equipment on date |
| idx_sessions_status | sessions | status | Active sessions only |
| idx_sessions_operator | sessions | operator_id | Operator's sessions |
| idx_sessions_operator_status | sessions | (operator_id, status) | "Active session for operator" hot path |

