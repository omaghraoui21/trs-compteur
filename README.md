# TRS Compteur — DPI

Application TRS/OEE avec **compteur continu** pour la production pharmaceutique DPI.
Equipements: Blistereuse IMA TR135S + Geluleuse Harro Hofliger Modu-C.

## Concept

Le **compteur** est une session continue par local/equipement. L'operateur l'ouvre manuellement, enregistre les phases (nettoyage, vide de ligne, CHSB, remplissage, pause) et les lots de production (1 ou plusieurs). Le superviseur valide les lots et peut "zoomer" sur n'importe quelle periode pour calculer le TRS.

```
Session (compteur):
  Nettoyage → Vide ligne → CHSB → Remplissage
    → LOT 1 (cadence, quantites, arrets)
    → Pause
    → Remplissage
    → LOT 2 (cadence, quantites, arrets)
  → Fermer compteur
```

## Architecture

```
packages/
  db/       — Schema PostgreSQL (Drizzle ORM)
  engine/   — Moteur TRS pur (computeLotTrs, computeSessionTrs, computeZoomTrs)
  api/      — API Express (auth, sessions, lots, dashboard)
  web/      — Frontend React + Vite + Tailwind
```

## Setup

```bash
# Prerequisites: Node 20+, pnpm, PostgreSQL

# 1. Install
pnpm install

# 2. Database
cp .env.example packages/api/.env
createdb trs_compteur
pnpm db:push

# 3. Seed
pnpm db:seed

# 4. Dev
pnpm dev:api   # API on :3001
pnpm dev:web   # Frontend on :5173
```

## Credentials

| Role | Email | Password |
|------|-------|----------|
| Operateur | operateur@dpi.local | oper123 |
| Superviseur | superviseur@dpi.local | super123 |
| Admin | admin@dpi.local | admin123 |

## TRS Formula (NF E 60-182)

```
tO = session duration (opened → closed)
tAP = planned stops (nettoyage + vide ligne + pause + CHSB + ...)
tR = tO - tAP
tF = sum(lot durations - unplanned downtimes)
tN = sum(produced / cadence)
tU = sum(conforming / cadence)

DO = tF / tR  (Disponibilite)
TP = tN / tF  (Performance)
TQ = conforming / produced  (Qualite)

TRS = tU / tR = DO x TP x TQ
TRG = tU / tO
```

## Zoom Levels

| Level | Scope | Use case |
|-------|-------|----------|
| Lot | 1 lot in 1 session | Detailed lot analysis |
| Session | 1 counter opening | Daily shift analysis |
| Day | All sessions in a day | Excel daily row equivalent |
| Week | 7 days | Weekly reporting |
| Month | Full month | Excel TOTAL MOIS equivalent |
