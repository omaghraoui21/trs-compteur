# Base de données — TRS Compteur

## Stack en production

| Composant | Service |
|-----------|---------|
| Hébergement app | Vercel (frontend + API serverless) |
| Base de données | **Railway Postgres** |
| DB name | `trs_compteur` |
| Proxy public | `kodama.proxy.rlwy.net:15687` |
| Connexion (variable) | `DATABASE_URL` dans les env vars Vercel |

> **Neon** : un projet Neon vide existe dans le compte Vercel Storage — il n'est pas connecté à l'application. L'app lit uniquement `DATABASE_URL` qui pointe sur Railway.

---

## Schéma — tables principales

### Données de référence (jamais effacées)

| Table | Rôle |
|-------|------|
| `rooms` | Salles de production (Salle Blistéreuse, Salle Géluleuse) |
| `equipments` | Machines avec objectif TRS et unité cadence par défaut |
| `products` | Produits avec cadence théorique |
| `product_equipment_cadences` | Cadence théorique par couple produit × machine |
| `downtime_categories` | Catégories d'arrêt (planifié / non planifié, famille NF E 60-182) |
| `phase_templates` | Gabarits de phases (legacy, plus utilisé en UI) |
| `users` | Opérateurs, superviseurs, admins |

### Données opérationnelles (effacées par `pnpm db:reset`)

| Table | Rôle |
|-------|------|
| `sessions` | Compteur continu par machine (openedAt → closedAt) |
| `session_events` | Timeline de phases (nettoyage, vide ligne, CHSB…) |
| `lot_entries` | Lots de production avec quantités et cadence effective |
| `lot_cadence_changes` | Historique des changements de cadence en cours de lot |
| `downtime_events` | Arrêts rattachés à un lot OU à la session (inter-lots) |
| `daily_summaries` | Résumés journaliers pré-calculés (non utilisé actuellement) |
| `audit_log` | Journal d'audit pharma — **append-only**, immuable via trigger |
| `electronic_signatures` | Signatures 21 CFR Part 11 (validation/rejet de lot) |
| `refresh_tokens` | Tokens JWT refresh (rotation automatique) |

### Contraintes importantes

- `downtime_events` : `lot_entry_id IS NOT NULL OR session_id IS NOT NULL` — un arrêt est toujours rattaché à un lot ou à une session.
- `lot_entries` : `quantity_conforming <= quantity_produced`, `cadence_used > 0`, quantités non négatives.
- `users` : rôle parmi `operator | supervisor | admin` (anglais dans la DB, jamais en français).
- `audit_log` : `UPDATE` et `DELETE` interdits par trigger PostgreSQL (`fn_audit_log_immutable`).

---

## Migrations Drizzle ORM

Les migrations sont dans `packages/db/drizzle/`. Elles s'appliquent automatiquement à **chaque déploiement Vercel** via `scripts/migrate.ts` (dans le `buildCommand` de `vercel.json`).

| Fichier | Description |
|---------|-------------|
| `0000_mighty_madame_hydra.sql` | Schéma initial complet |
| `0001_ensure_all_columns.sql` | Colonnes manquantes sur tables bootstrappées via `db:push` |
| `0002_downtime_events_columns.sql` | Idem pour `downtime_events` (status, is_short_stop, comment, created_by) |
| `0003_phase_templates.sql` | Table `phase_templates` |
| `0004_db_hardening.sql` | Contraintes CHECK + trigger audit immuable |
| `0005_electronic_signatures.sql` | Table `electronic_signatures` (21 CFR Part 11) |
| `0006_refonte_arrets_session_level.sql` | `downtime_events.session_id` + FK + CHECK lot-ou-session |
| `0007_lot_cadence_changes.sql` | Table `lot_cadence_changes` |
| `0008_ensure_session_downtime_columns.sql` | **Sécurité idempotente** : ré-applique 0006+0007 si jamais skippés (même pattern que 0002) |

### Règle importante sur les nouvelles migrations

La base a été initialisée via `db:push` (pas via `drizzle migrate`). Cela signifie que le journal `__drizzle_migrations` peut marquer une migration comme appliquée sans que le DDL ait réellement tourné. **Toute nouvelle migration doit utiliser `IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object`** pour rester idempotente.

Ne jamais utiliser `drizzle-kit push` en production — uniquement `scripts/migrate.ts`.

---

## Commandes courantes

```bash
# Appliquer les migrations manuellement (nécessite DATABASE_URL)
DATABASE_URL="postgresql://..." pnpm db:migrate

# Vérifier le type-check du schéma
pnpm --filter @trs/db typecheck

# Réinitialiser les données opérationnelles avant un nouveau lancement
pnpm db:reset             # dry-run — affiche les compteurs sans rien effacer
pnpm db:reset -- --yes    # ⚠ efface les tables opérationnelles (irréversible)

# Générer une nouvelle migration après modification du schéma
pnpm db:generate          # crée le fichier SQL dans packages/db/drizzle/
# → éditer le fichier généré pour ajouter IF NOT EXISTS sur chaque statement
# → commit le fichier + meta/_journal.json
```

### `pnpm db:reset` — ce qui est gardé / effacé

| Gardé | Effacé |
|-------|--------|
| rooms, equipments, products | sessions, session_events |
| downtime_categories | lot_entries, lot_cadence_changes |
| product_equipment_cadences | downtime_events |
| phase_templates | daily_summaries |
| users | audit_log, electronic_signatures |
| — | refresh_tokens |

---

## Connexion depuis Vercel

Railway expose la base sur un **port non-standard** (ex. `15687`). Ce port est accessible depuis les fonctions Vercel (AWS us-east-1) mais **pas depuis les environnements sandbox** (politique réseau restrictive — seul le port 443 est ouvert). Pour toute opération manuelle sur la DB depuis un poste local, utiliser le DATABASE_URL Railway directement avec `psql` ou `pnpm db:migrate`.

La configuration de pool dans `packages/db/src/index.ts` :
- **Vercel** : `max: 1` connexion par instance (évite une tempête de connexions Neon/Railway au cold-start)
- **Railway/Docker** : `max: 10`
- `connect_timeout: 15 s`, `idle_timeout: 20 s`, `prepare: false` (compatible PgBouncer)

---

## Backup

Le workflow `.github/workflows/db-backup.yml` tourne chaque nuit à 02:00 UTC :
- Sans secrets S3 → artifact GitHub (rétention 90 jours)
- Avec `BACKUP_S3_*` → upload S3-compatible (Backblaze B2 / Cloudflare R2 / MinIO) avec rétention ≥ 1825 jours (5 ans GxP)

Pour un backup manuel :
```bash
pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d).sql
```
