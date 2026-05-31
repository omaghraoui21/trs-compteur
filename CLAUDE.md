# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TRS Compteur is a pharmaceutical production OEE (Overall Equipment Effectiveness) tracking application for DPI equipment (Blistereuse IMA TR135S, Géluleuse Harro Hofliger Modu-C). It implements the **NF E 60-182** standard for TRS calculation.

## Monorepo Structure

pnpm workspace with four packages under `packages/`:

- **`@trs/engine`** — Pure TypeScript TRS calculation core (NF E 60-182). No runtime dependencies. The source of truth for all OEE math.
- **`@trs/db`** — Drizzle ORM schema and migrations for PostgreSQL.
- **`@trs/api`** — Express.js REST API (auth, sessions, lots, dashboard, admin).
- **`@trs/web`** — React 19 + Vite frontend with Tailwind CSS.

Dependency chain: `web` and `api` both depend on `engine` and `db`.

## Commands

```bash
# Development
pnpm dev:api          # Start API server on :3001
pnpm dev:web          # Start Vite dev server on :5173

# Build
pnpm build            # Build all packages
node scripts/build-api.mjs   # Rebuild api/handler.mjs (Vercel serverless bundle)

# Database
pnpm db:push          # Apply schema changes to DB (drizzle-kit push)
pnpm db:seed          # Seed initial data (rooms, equipment, products, users)

# Type checking
pnpm typecheck        # Run tsc --noEmit across all packages

# Tests (engine package only)
pnpm --filter @trs/engine test   # Run Vitest unit tests
```

## Environment Setup

Copy `.env.example` to `.env` and set:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret for JWT signing
- `PORT` — API port (default: 3001)

## Architecture

### TRS Engine (`packages/engine/src/`)

Core exports from `trs.ts`:
- `computeLotTrs()` — TRS for a single production lot
- `computeSessionTrs()` — Aggregates lots within a session (daily)
- `computeZoomTrs()` — Multi-session aggregation (day/week/month)
- `computeProductTrs()` — TRS grouped by product across lots
- `computeSixBigLosses()` — OEE six big losses breakdown
- `familleToNorme()` — Maps downtime categories to NF E 60-182 codes

Time utilities are in `time.ts`: `diffMinutes()`, `toMinutes()`, `fmtDuration()`.

TRS formula: **TRS = DO × TP × TQ** where:
- DO (Disponibilité) = tF / tR
- TP (Performance) = tN / tF
- TQ (Qualité) = conforming / produced
- TRG (global) = tU / tO

### Database Schema (`packages/db/src/schema.ts`)

Key tables and their roles:
- `sessions` — Continuous production counters (openedAt → closedAt)
- `sessionEvents` — Phase timeline entries (nettoyage, vide_ligne, CHSB, remplissage, pause, lot_start, lot_end)
- `lotEntries` — Individual lots with quantities, cadence, supervisor validation status
- `downtimeEvents` — Stops/maintenance linked to NF E 60-182 categories
- `equipments` — Machines with TRS objectives
- `productEquipmentCadences` — Product-specific cadence per machine

### API Routes (`packages/api/src/routes/`)

All routes require JWT (set in `middleware.ts`). Role-based access: `operator`, `supervisor`, `admin`.

> **Important:** role enum values in the DB are English (`operator`, `supervisor`, `admin`), not French. The CLAUDE.md credential table uses French email prefixes but the role string is English.

- `auth.ts` — POST `/api/auth/login`
- `sessions.ts` — Session lifecycle (open/close) and event recording
- `lots.ts` — Lot creation, editing, supervisor validation
- `dashboard.ts` — Aggregated TRS metrics for charts
- `admin.ts` — CRUD for equipment, products, users, downtime categories
- `ref.ts` — Reference data lookups

#### API error handling & validation (`packages/api/src/lib/`, `packages/api/src/schemas.ts`)

- `lib/http.ts` — `asyncHandler(fn)` wraps async route handlers so rejected promises reach the Express error middleware; `HttpError(status, message)` for typed HTTP errors; `validate(schema)` middleware runs Zod on `req.body` and returns 400 on failure.
- `schemas.ts` — Zod schemas for every write endpoint: `loginSchema`, `openSessionSchema`, `addEventSchema`, `startLotSchema`, `closeLotSchema` (enforces `conforming ≤ produced`), `updateLotSchema`, `addDowntimeSchema`, `validateLotSchema`.
- `server.ts` — Terminal 4-arg error middleware after all routers: returns `{ error }` JSON for `HttpError` instances, logs and returns 500 for everything else.
- All async route handlers are wrapped with `asyncHandler`. All mutating endpoints use `validate()` middleware.
- **Authorization:** `POST /lots/:id/validate` requires `requireRole("supervisor", "admin")` — operators cannot validate their own lots.

### Frontend Pages (`packages/web/src/pages/`)

- `Compteur.tsx` — Main operator view (session management, phase recording, lot entry) — touch-optimised, `BTN_PRIMARY` = min 48px touch targets
- `Dashboard.tsx` — TRS analytics with Recharts visualizations, zoom levels (day/week/month/custom), CSV + PDF export
- `Admin.tsx` — Admin panel for reference data management (5 tabs: rooms, equipments, products, cadences, downtimes)
- `Supervisor.tsx` — Lot validation queue; expandable cards with coherence checks
- `Login.tsx` — JWT authentication form

#### Frontend shared components (`packages/web/src/components/`)

- `Layout.tsx` — App shell. **Responsive:** persistent `w-48` sidebar at `lg:`+; fixed bottom tab bar (`lg:hidden`) with icon + short label for mobile/tablet. Role-based nav filtering via `item.roles` array.
- `Toast.tsx` — Dependency-free toast system (`ToastProvider` + `useToast()` hook). Auto-dismisses after 5 s. Variants: `success` (green) / `error` (red). Positioned full-width at bottom on mobile, corner on `sm`+, lifted above the tab bar.

#### Frontend styling notes

- `index.css` — Tailwind directives + two component-layer utilities (`.input-field`, `.btn-primary`) + `.rtable` responsive-table CSS (collapses tables into label/value cards at `< 768px` on Admin pages using `data-label` attributes).
- `tailwind.config.js` — Default Tailwind, no custom theme extensions.
- Recharts (`v3`) for all dashboard charts; `ResponsiveContainer` used throughout.
- Icons: `lucide-react`.

#### Responsive breakpoints (mobile-first)

| Breakpoint | Layout |
|-----------|--------|
| `< lg` (< 1024px) | Bottom tab bar, full-width content |
| `lg`+ | Persistent left sidebar, content beside it |

- TRS 5-metric grids: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`
- Admin tables use `.rtable` class — add `data-label="…"` to every `<td>` when adding new columns
- Admin tab bar: `overflow-x-auto` + `whitespace-nowrap` so all tabs are reachable on phones
- Dashboard filter bar: stacks vertically on mobile (`flex-col sm:flex-row`)

### Deployment

- **Vercel**: `scripts/build-api.mjs` bundles the API via esbuild into `api/handler.mjs` (serverless function). Frontend builds to `packages/web/dist`. `vercel.json` sets `buildCommand`, `outputDirectory`, function config, and SPA rewrite.
  - **Important:** `api/handler.mjs` is committed to git. After any backend source change, rebuild it with `node scripts/build-api.mjs` and commit the result before merging to the production branch — otherwise the stale bundle will be served until Vercel's build step regenerates it.
- **Docker**: Runs `tsx packages/api/src/server.ts` directly on Node 20-slim.
- **CI**: `.github/workflows/db-backup.yml` runs a daily verified `pg_dump` at 02:00 UTC. For durable multi-year (pharma GxP) retention it uploads each dump to S3-compatible storage when the `BACKUP_S3_*` secrets are set (AWS S3 / Backblaze B2 / Cloudflare R2 / MinIO); otherwise it keeps a 90-day GitHub artifact and emits a warning. Configure the bucket with a ≥1825-day lifecycle + Object Lock (WORM).
- **Production branch**: `devin/1779664896-initial-app` — this is what Vercel deploys. Merge feature branches here (not `main`; there is no `main`).

## Seeded Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Operator | operateur@dpi.local | oper123 |
| Supervisor | superviseur@dpi.local | super123 |
| Admin | admin@dpi.local | admin123 |

## Key invariants

- **Never change TRS math** in `packages/engine/` without running `pnpm --filter @trs/engine test` (35 unit tests covering NF E 60-182 compliance).
- **Role strings are English** in code/DB (`operator`, `supervisor`, `admin`). French appears only in UI labels.
- **`asyncHandler` is mandatory** on every async Express route handler — raw `async (req, res) => {}` handlers swallow errors silently in Express 4.
- **`validate(schema)` before DB writes** — Zod schemas in `schemas.ts` are the single source of truth for input constraints; do not add ad-hoc `if (!x)` checks in handlers.
- **Rebuild `api/handler.mjs`** after any API source change before pushing to production (see Deployment above).
