#!/usr/bin/env bash
#
# fresh-production-launch.sh — Démarrage de prod à blanc, en une commande.
#
# Enchaîne, dans l'ordre sûr :
#   1. Backup horodaté de la base (pg_dump)         → indispensable, irréversible
#   2. Dry-run du reset (affiche les compteurs)     → ce qui VA être effacé
#   3. Confirmation explicite (taper OUI)           → garde-fou anti-erreur
#   4. Reset réel (pnpm db:reset -- --yes)          → vide les tables opérationnelles
#   5. Vérification post-reset                      → confirme que tout est à zéro
#
# Conserve les données de référence (salles, équipements, produits, users,
# cadences, catégories d'arrêt, templates de phases). Voir
# scripts/reset-operational-data.ts pour le détail des tables.
#
# Usage :
#   DATABASE_URL=postgres://… ./scripts/fresh-production-launch.sh
#   ./scripts/fresh-production-launch.sh --yes      # saute la confirmation manuelle
#
# ⚠ Opération irréversible (contexte pharma GxP). Le backup est obligatoire :
#   le script s'arrête s'il ne peut pas le produire.

set -euo pipefail

# Toujours travailler depuis la racine du repo, quel que soit le cwd d'appel.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

AUTO_YES=0
[[ "${1:-}" == "--yes" || "${CONFIRM_RESET:-}" == "YES" ]] && AUTO_YES=1

# ── 0. Pré-requis ──────────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FATAL: DATABASE_URL n'est pas défini — abandon." >&2
  echo "   Exporte-le d'abord :  export DATABASE_URL='postgres://…'" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "FATAL: pg_dump introuvable (paquet postgresql-client) — abandon." >&2
  echo "   Le backup est obligatoire avant un reset irréversible." >&2
  exit 1
fi

DB_HOST="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*@([^/:]+).*#\1#')"
echo ""
echo "  Base cible : $DB_HOST"

# ── 1. Backup ──────────────────────────────────────────────────────────────
BACKUP_DIR="$REPO_ROOT/backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).sql"

echo ""
echo "  [1/5] Backup → $BACKUP_FILE"
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"

if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "FATAL: le backup est vide — abandon (rien n'a été effacé)." >&2
  exit 1
fi
echo "        OK ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── 2. Dry-run ─────────────────────────────────────────────────────────────
echo ""
echo "  [2/5] Aperçu de ce qui sera effacé :"
pnpm db:reset

# ── 3. Confirmation ────────────────────────────────────────────────────────
if [[ "$AUTO_YES" -ne 1 ]]; then
  echo ""
  echo "  ⚠ Action IRRÉVERSIBLE sur $DB_HOST."
  read -r -p "  Tape OUI pour effacer les données opérationnelles : " answer
  if [[ "$answer" != "OUI" ]]; then
    echo "  Annulé. Rien n'a été effacé. (Backup conservé : $BACKUP_FILE)"
    exit 0
  fi
fi

# ── 4. Reset réel ──────────────────────────────────────────────────────────
echo ""
echo "  [4/5] Reset en cours…"
pnpm db:reset -- --yes

# ── 5. Vérification ────────────────────────────────────────────────────────
echo ""
echo "  [5/5] Vérification post-reset :"
pnpm db:reset   # dry-run : doit afficher 0 partout

echo ""
echo "  ✅ Base prête pour la nouvelle prod (données de référence conservées)."
echo "     Backup de sécurité : $BACKUP_FILE"
echo ""
