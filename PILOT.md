# Pilot runbook — TRS Compteur

This is the checklist to stand up the app for a **pilot test** on a single DPI
line. A pilot means: real operators entering real data, run **in parallel** with
your current system. It is **not** a GMP-validated system of record — formal
IQ/OQ/PQ qualification is a separate, later effort.

## 1. Provision

- A PostgreSQL database (Neon, RDS, or self-hosted ≥ 14).
- A host for the app (Vercel for the bundled serverless API + SPA, or Docker
  on Railway/Fly/VM).

## 2. Configure environment

Set these (see `.env.example` for the full list):

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `JWT_SECRET` | ✅ | Long random string. In production the API refuses to boot without it. |
| `APP_TIMEZONE` | ✅ recommended | Plant local timezone, e.g. `Europe/Paris`. Dates shifts to the correct local day (night shifts otherwise misdate under UTC). |
| `NODE_ENV=production` | ✅ | Enables strict CORS + JWT boot check |
| `ALLOWED_ORIGIN` | if SPA on a different host | Otherwise same-origin only |

## 3. Database

```bash
# Apply schema (versioned migrations — runs constraints + audit/e-signature triggers)
pnpm --filter @trs/db exec drizzle-kit migrate   # or: migrations run at boot (Docker) / build (Vercel)
pnpm db:seed                                      # rooms, equipment, products, categories, 3 users
```

Migrations 0004 (CHECK constraints + audit immutability) and 0005 (electronic
signatures) must be applied — verify the `electronic_signatures` table and its
triggers exist.

## 4. Secure the accounts (do this before anyone logs in)

The seed creates three demo accounts with **weak shared passwords**
(`operateur@dpi.local`/`oper123`, etc.). Before the pilot:

1. Log in as `admin@dpi.local`.
2. **Configuration → Utilisateurs**: create a real account per pilot user with
   their own role, and set a strong password (or have them set it).
3. Each user can change their own password from the **key icon** in the header.
4. Deactivate or repurpose the demo accounts you don't need.

## 5. Smoke test (5 min)

1. Operator: open a session, record a phase, start a lot, record a downtime,
   close the lot.
2. Supervisor: validate the lot — confirm the **electronic-signature** dialog
   asks for the password and the lot leaves the queue.
3. Dashboard: confirm the day shows TRS/TRG and the **Vérification TRS** panel
   reads "Cohérent".

## 6. Backups (recommended before real data)

The daily backup workflow (`.github/workflows/db-backup.yml`) keeps a 90-day
GitHub artifact by default. For durable retention, set `BACKUP_S3_BUCKET` +
`AWS_*` secrets (see the workflow header).

## Known limitations for a pilot

- **Not GMP-validated.** Do not use as the official record until IQ/OQ/PQ is done.
- **One line.** Multi-line/multi-site is out of scope.
- **Shop-floor device** (tablet/kiosk) should be tested on the real hardware —
  the UI is touch-optimised but verify on your device.
- Password policy (complexity/expiry) is not yet enforced — set strong passwords
  manually.
