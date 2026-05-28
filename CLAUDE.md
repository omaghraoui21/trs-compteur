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

All routes require JWT (set in `middleware.ts`). Role-based access: `operateur`, `superviseur`, `admin`.

- `auth.ts` — POST `/api/auth/login`
- `sessions.ts` — Session lifecycle (open/close) and event recording
- `lots.ts` — Lot creation, editing, supervisor validation
- `dashboard.ts` — Aggregated TRS metrics for charts
- `admin.ts` — CRUD for equipment, products, users, downtime categories
- `ref.ts` — Reference data lookups

### Frontend Pages (`packages/web/src/pages/`)

- `Compteur.tsx` — Main operator view (session management, phase recording, lot entry) — largest file ~950 LOC
- `Dashboard.tsx` — TRS analytics with Recharts visualizations, zoom levels
- `Admin.tsx` — Admin panel for reference data management
- `Supervisor.tsx` — Lot validation interface
- `Login.tsx` — JWT authentication form

### Deployment

- **Vercel**: `scripts/build-api.mjs` bundles the API via esbuild into `api/handler.mjs` (serverless function). Frontend builds to `packages/web/dist`.
- **Docker**: Runs `tsx packages/api/src/server.ts` directly on Node 20-slim.
- **CI**: `.github/workflows/db-backup.yml` runs daily `pg_dump` at 02:00 UTC.

## Seeded Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Operateur | operateur@dpi.local | oper123 |
| Superviseur | superviseur@dpi.local | super123 |
| Admin | admin@dpi.local | admin123 |
