# Frontend E2E Debug & UX Report

**Branch:** `claude/frontend-e2e-debug-w6x12a`
**Method:** Drove the Vite frontend with Playwright (API routes mocked, no DB
required), recording **video + full-page PNG screenshots** of every key flow at
**desktop (1280×800)** and **mobile (Pixel 7)** viewports — *before* and *after*
fixes. The recorder lives in `e2e/tour/` (`TOUR_PHASE=before|after`); artifacts
land in `artifacts/<phase>/<viewport>/` (git-ignored).

## Headline result

| | Before | After |
|---|---|---|
| `pnpm test:e2e` (32 tests) | **6 passed / 26 failed**, 4.6 min | **32 passed**, ~21 s |
| Supervision page | **Full-page crash** (ErrorBoundary) | Renders the validation queue |
| Operator journey | **Blocked** at room picker | Completes through new-lot form |
| `pnpm typecheck` | clean | clean |
| `@trs/engine` tests | 99 passed | 99 passed |

The E2E suite had silently rotted: the UI evolved but the specs didn't, so 26/32
tests failed and each burned its full 20 s timeout (hence the 4.6 min runtime).

## Bugs found (with evidence)

### 1. App bug — Supervision page crashes on a missing session date
`fmtSessionDate(iso)` did `iso.split("-")` with no guard. A `PendingLot` whose
`sessionDate` is null/undefined threw `Cannot read properties of undefined
(reading 'split')`, and because `SupervisorPage` is wrapped in an
`ErrorBoundary` the **entire validation queue white-screened** — no lots could
be validated. Evidence: `artifacts/before/desktop/20-supervisor-queue.png`.

**Fix** (`packages/web/src/pages/Supervisor.tsx`): made `fmtSessionDate`
null-safe — returns `—` for a missing date, echoes a malformed value rather than
crashing. One bad record can no longer take down the whole page.
Evidence: `artifacts/after/desktop/20-supervisor-queue.png`.

### 2. E2E infra — first-run onboarding overlay blocked every operator test
The `Onboarding` coach-mark modal shows on first load (until
`localStorage.trs_onboarding_done` is set) and intercepts pointer events. Test
fixtures injected auth tokens but not the onboarding flag, so every click on the
operator view hit the overlay. Evidence:
`artifacts/before/desktop/10-operator-room-picker.png` (modal over the room
picker). **Fix:** `injectTokens` now also sets `trs_onboarding_done`.

### 3. E2E infra — `PENDING_LOT` fixture missing required fields
`PendingLot` requires `sessionDate`, `operatorName`, `equipmentName`,
`equipmentCode`, `sessionNotes`; the shared fixture omitted them, triggering bug
#1 in tests. **Fix:** completed the fixture object.

### 4. App bug — operator action buttons clipped on narrow phones
The 3-button action bar ("Déclarer un arrêt" / "Nouveau lot" / "Fermer") used
`flex-1` buttons whose default `min-width:auto` refused to shrink below their
content width, so the row overflowed the viewport and **clipped the "Fermer"
button** on phones. Evidence: `artifacts/after/mobile/13-operator-session-open.png`
(clipped) vs `artifacts/verify/mobile/13-operator-session-open.png` (fixed).
**Fix** (`packages/web/src/pages/Compteur.tsx`): added `min-w-0` to the shared
`BTN_PRIMARY` (lets flex buttons shrink to equal thirds; text wraps inside) and
`shrink-0` to `BTN_ICON` (keeps icons crisp). Touch-only screen, so this matters.

### 5–9. E2E specs — selectors drifted from the current UI
| Spec | Stale assumption | Reality | Fix |
|---|---|---|---|
| `auth` | redirect to `/login` | login renders in place at `/` | assert the login form is shown |
| `auth` | `getByLabel(/mot de passe/i)` | also matches the show/hide-password toggle | target `#login-password` |
| `operator` | button "Ouvrir **un** compteur" | "Ouvrir **le** compteur" | update copy |
| `operator` | "Fermer" trigger | accessible name is "Fermer la session" | open via `/fermer la session/i`, keep `/^fermer$/i` for the modal confirm |
| `operator` | label "Numéro de lot"; product picked as text | label "N° de lot"; product is a `<select>` | use labels + `selectOption` |
| `supervisor` | `/réduire/i` | matches both the header toggle aria-label and the footer button | `{ name: "Réduire", exact: true }` |
| `supervisor` | "Rejeter" opens modal directly | a rejection **comment is mandatory** (GMP) first | fill the comment, then reject |
| `dashboard` | one "Mois"/"CSV" button; custom = "Personnalisé" | duplicate zoom buttons; "Export CSV"; custom = "Libre" | scope/`exact` selectors; use "Libre" |

## UX/UI review (screenshots)
Login, Dashboard (desktop + mobile, charts stack cleanly), and Admin (responsive
tabs, empty states) all render well across both viewports — no layout defects
found. The only genuine defect surfaced visually was the Supervision crash (#1).

## Tooling note
`@playwright/test` was not a project dependency, so `pnpm test:e2e` could not even
load its config. Added it as a workspace dev dependency.

## What changed
- `packages/web/src/pages/Supervisor.tsx` — null-safe `fmtSessionDate` (app fix).
- `e2e/fixtures/{index,data}.ts` — dismiss onboarding; complete `PENDING_LOT`.
- `e2e/tests/{auth,operator,supervisor,dashboard}.spec.ts` — selector/copy repairs.
- `e2e/tour/` — reusable before/after video + screenshot recorder.
- `package.json` — add `@playwright/test` dev dependency.
