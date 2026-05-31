# REFONTE — Modèle unifié « Arrêts » (planifié / non planifié)

> Branche : `claude/new-session-29dl2` (isolée de la prod `devin/1779664896-initial-app`).
> Merge en prod **uniquement** après `/verify` E2E vert.

## Décision produit

Suppression totale de la notion de **« phase »**. Deux états déclarables seulement :
**arrêt planifié** et **arrêt non planifié**. Les anciennes phases (nettoyage,
changement de série CHSB/CHSG, pause, vide ligne, maintenance préventive) deviennent
des **motifs d'arrêt planifié**.

### Principe unique
> **La ligne tourne par défaut. On ne déclare que des ARRÊTS. Le temps de marche est le RESTE.**
> Le lot ne porte plus que : produit + cadence + quantités.

### Cascade NF E 60-182 (formules inchangées)
```
tO        = durée de la session (ouverture → clôture compteur)
tAP       = Σ arrêts PLANIFIÉS
tR        = tO − tAP
tF        = tR − Σ arrêts NON PLANIFIÉS        ← « la ligne tourne » = le reste
À CLASSER = tO − Σlots − Σ arrêts inter-lots    ← doit tendre vers 0 (obligatoire)
TRS = tU/tR · DO = tF/tR · TP = tN/tF · TQ = conforme/produite
```

### Décisions validées
| Sujet | Choix |
|---|---|
| Phases | **supprimées** de l'UI (tables gardées, dépréciées) |
| Arrêt hors lot | **niveau session** (`lotEntryId` nullable + `sessionId`) |
| Bouton opérateur | **un seul** « Déclarer un arrêt » → 2 sections |
| Temps non déclaré | **« À classer »** obligatoire (modèle Reason Codes) |
| tO | **durée de la session** |
| Cadence | **éditable en cours de lot + historique** (event `cadence_change`, moyenne pondérée) |
| Validation superviseur | **unitaire** (pas de groupée), contrôles enrichis |
| Visuel Géluleuse/Blistéreuse | **charte unique** (différence fonctionnelle conservée) |

## Garde-fous anti-régression
1. Branche isolée — prod intouchée tant que `/verify` pas vert.
2. Migrations **additives** (jamais de DROP de données). `sessionEvents` / `phaseTemplates` conservées, dépréciées.
3. **Math engine intouchée** — 50 tests restent verts.
4. 1 phase = 1 commit = `typecheck` + tests engine + capture.
5. Migration de données : ex-phases planifiées → arrêts planifiés (conservés).

## Avancement
- [x] **Phase 0** — Filet de sécurité (branche + baseline verte : typecheck OK, 50 tests engine)
- [x] **Phase 1** — Visuel standardisé Géluleuse/Blistéreuse
- [x] **Phase 2** — Unifier les 2 seeds (`scripts/seed.ts` ⟷ `lib/seed.ts`)
- [ ] **Phase 3** — Refonte Arrêts (DB + API + engine + opérateur + migration données)
- [ ] **Phase 4** — Cadence modifiable pendant le lot (+ historique)
- [ ] **Phase 5** — Validation superviseur enrichie
- [ ] **Phase 6** — Clôture : rebuild handler, typecheck, tests, `/verify`, `/simplify`, `/loop`
