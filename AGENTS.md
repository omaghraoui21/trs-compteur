# AGENTS.md

Guidance for AI coding agents working in this repository.

## Cursor Cloud specific instructions

### Services overview

| Service | Port | Command | Required for E2E |
|---------|------|---------|------------------|
| PostgreSQL 16 | 5432 | See below | Yes |
| `@trs/api` (Express) | 3001 | `pnpm dev:api` | Yes |
| `@trs/web` (Vite) | 5173 | `pnpm dev:web` | Yes |

Minimum stack: PostgreSQL → API → Web. The web dev server proxies `/api` to `http://localhost:3001` (see `packages/web/vite.config.ts`).

### PostgreSQL (not in update script)

There is no `docker-compose` in this repo. Cloud VMs need a local Postgres instance:

```bash
sudo pg_ctlcluster 16 main start   # or: sudo service postgresql start
pg_isready -U postgres
```

First-time DB setup (once per fresh VM):

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb trs_compteur
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trs_compteur
pnpm db:push && pnpm db:seed
```

Copy env before starting the API: `cp .env.example packages/api/.env` (and set `DATABASE_URL` / `JWT_SECRET`). The `db:*` CLI commands read `DATABASE_URL` from the shell environment, not from `packages/api/.env`.

### Starting dev servers

Use separate tmux sessions so servers stay running:

```bash
pnpm dev:api   # :3001
pnpm dev:web   # :5173
```

Health check: `curl http://localhost:3001/api/health` → `{"status":"ok","db":"connected"}`.

### Lint / typecheck / test / build

| Command | Notes |
|---------|-------|
| `pnpm lint` | Stub only (`echo ok` in `@trs/web`); no ESLint configured |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Engine unit + API integration + web unit tests |
| `pnpm build` | Builds all packages; API bundle for Vercel is `node scripts/build-api.mjs` |

API integration tests need Postgres and `TEST_PG_ADMIN_URL` (default `postgres://postgres:postgres@127.0.0.1:5432/postgres`). They create/drop throwaway databases.

### Seeded credentials

| Role | Email | Password |
|------|-------|----------|
| Operator | operateur@dpi.local | oper123 |
| Supervisor | superviseur@dpi.local | super123 |
| Admin | admin@dpi.local | admin123 |

### Railway

`railway.toml` deploys the Docker image with `node api/handler.mjs`. Railway CLI: `~/.railway/bin/railway`. Set a valid **account or project token** in `RAILWAY_TOKEN` before using `railway variables`, `railway logs`, etc. Invalid tokens return `Invalid RAILWAY_TOKEN`.

Local development does **not** require Railway; use local Postgres as above.

### Gotchas

- **esbuild build scripts**: pnpm may warn about ignored build scripts; run `pnpm build` once after install if Vite/esbuild misbehaves.
- **Active session per equipment**: opening a second session on the same equipment returns 409 with the existing `sessionId`.
- **Lot API paths**: create lots via `POST /api/lots` (not `/api/sessions/:id/lots/start`); close with `quantityProduced` / `quantityConforming` field names.
- **Rebuild `api/handler.mjs`** after any API source change before merging to the production branch (`devin/1779664896-initial-app`).

See `CLAUDE.md` for architecture, TRS invariants, and deployment details.
