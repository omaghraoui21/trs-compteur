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
| `pnpm test:e2e` | **6 passed / 26 failed** (32 tests), 4.6 min | **38 passed** (+6 new Admin tests), ~25 s |
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

## Accessibility audit (axe-core, WCAG 2.1 A/AA)
Added `e2e/tests/a11y.spec.ts` — runs `@axe-core/playwright` against login,
operator, supervisor (expanded), dashboard and admin.

- **Structural a11y is clean and now gated:** zero serious/critical findings for
  missing labels, button names, roles or ARIA across all five flows.
- **Color contrast (advisory):** the audit flagged muted neutral text
  (`text-gray-400`, #9ca3af → 2.53:1, below the 4.5:1 AA threshold) used 98× for
  secondary/empty-state copy. **Fixed** by darkening it to `text-gray-500`
  (~4.8:1 on white/gray-50) across 14 files — a monotonic, non-semantic
  readability win that matters on bright shop-floor screens. The ~7 remaining
  contrast findings per page are the app's *semantic* TRS palette
  (green/amber/red from the engine's `trsColor()`); recolouring those is a
  design decision, so the gate excludes `color-contrast` (run the spec without
  `.disableRules` to see the advisory report).

## UX/UI review (screenshots)
Login, Dashboard (desktop + mobile, charts stack cleanly), and Admin (responsive
tabs, empty states) all render well across both viewports — no layout defects
found. The only genuine defect surfaced visually was the Supervision crash (#1).

## Tooling / CI
- `@playwright/test` was not a project dependency, so `pnpm test:e2e` could not
  even load its config. Added it as a workspace dev dependency.
- **The E2E suite never ran in CI** (`.github/workflows/ci.yml` had only the
  engine/API jobs) — which is exactly why it silently rotted to 6/32. Added a
  dedicated `e2e` CI job (mocked API → no DB/API service needed; installs
  chromium, runs `pnpm test:e2e`, uploads the Playwright report on failure) so
  this regression can't recur unnoticed.

## Loop 2 — deeper interaction coverage
A second evidence pass recorded the interaction states not previously captured
(login error + password reveal, declare-downtime form, end-of-shift modal,
change-password modal, admin create-room form) at desktop + mobile via
`e2e/tour/interactions.spec.ts`. **No new app defects surfaced** — all states
render correctly across both viewports. The verified-working flows that had zero
regression protection were locked down with tests:
- `auth.spec.ts`: password-visibility toggle flips the input `type` and the
  toggle's accessible name (the element that caused the earlier selector clash).
- `layout.spec.ts`: change-password modal — mismatched passwords show an error
  and never call the API; matching passwords submit and show success.

Suite is now **46 tests**.

## Loop 3 — Admin delete confirmation (real a11y bug) + CRUD coverage
Exercising the admin delete flow surfaced a genuine keyboard/a11y defect:

- **Bug:** the `ConfirmDeleteModal` (destructive "Désactiver" confirmation,
  `role="dialog" aria-modal`) never moved focus into itself on open — focus
  stayed on the trash button *outside* the overlay. Its Escape handler relies on
  the keydown bubbling up from a focused element inside the overlay, so **Escape
  did nothing** and keyboard users were stranded outside the dialog. Verified
  empirically (modal stayed open on Escape; `document.activeElement` was the
  trash button). Unlike the Layout `ChangePasswordModal`, it had no focus
  management.
- **Fix** (`Admin.tsx`): focus the Cancel button on open (the safe default for a
  destructive prompt), which also makes Escape work.
- **Coverage** (`admin.spec.ts`): Escape closes the modal (regression),
  Confirmer issues the DELETE + success toast, Annuler closes without deleting,
  and "Ajouter" opens the create-room form.

Suite is now **50 tests**.

## Loop 4 — Dashboard invalid date-range still queried (real bug)
The "Libre" custom range validates start ≤ end ≤ today and shows an inline
alert, but the query memo (`{from,to}`) used the custom dates **without checking
validity** — so an invalid range still hit the API behind the error message.
Reachable: pick the end date first, then a later start date (the `from` input has
no `min`). Probe confirmed the dashboard queried `from=…-29&to=…-19` (from > to)
while the alert was shown.

- **Fix** (`Dashboard.tsx`): the memo now only uses the custom range when
  `start ≤ end ≤ today`, else falls back to the month preset (same as the empty
  case) — the validation is now protective, not cosmetic.
- **Coverage** (`dashboard.spec.ts`): an invalid range shows the alert and never
  issues a query with `from > to`.

Suite is now **51 tests**.

## Loop 5 — Supervisor correction coherence gap (real bug)
The inline "Corriger les données" form gated its coherence checks on the *edited*
field (`qConf !== ""` / `qRej !== ""`), so **lowering "Qté produite" below the
untouched conforming/rebut slipped through** — the effective values became
incoherent (conforming > produced, violating `closeLotSchema`) yet no error
showed and "Signer la correction" stayed enabled. Probe confirmed produced=100
with conforming=14256 was submittable.

- **Fix** (`Supervisor.tsx`): compute `confErr`/`rejErr` from the *effective*
  values (corrected-or-existing) regardless of which field was edited.
- **Coverage** (`supervisor.spec.ts`): lowering produced below conforming is
  flagged + disables signing; a coherent correction enables it.

Suite is now **53 tests**.

## Coverage added
The **Admin / Configuration** page was the only major page with no E2E coverage
(protected by `typecheck` alone — exactly the gap that let the Supervision crash
ship). Added `e2e/tests/admin.spec.ts` (6 smoke tests: page render, tab
navigation across Locaux/Équipements/Produits/Utilisateurs, and the empty
state) plus an `adminPage` fixture and `mockAdminRoutes` helper.

## What changed
- `packages/web/src/pages/Supervisor.tsx` — null-safe `fmtSessionDate` (app fix).
- `e2e/fixtures/{index,data}.ts` — dismiss onboarding; complete `PENDING_LOT`.
- `e2e/tests/{auth,operator,supervisor,dashboard}.spec.ts` — selector/copy repairs.
- `e2e/tour/` — reusable before/after video + screenshot recorder.
- `package.json` — add `@playwright/test` dev dependency.

## Loop 6 — downtime-submit coverage (no new bug)
Probed the new-lot batch-number regex (`^[A-Z0-9-_./]{1,30}$` — confirmed no
unintended `-` range; rejects `;@[]^<=>?`), the chronometer downtime entry
(ceil to ≥1 min, interval cleared on unmount, can't double-start via UI), and
the downtime-submit handler — all sound. Added the missing coverage for the
critical inter-lot downtime flow: select category + duration → POST
`/sessions/:id/downtimes` with the right payload → returns to the timeline.
Suite is now **54 tests**.

## Loop 7 — CSV formula injection in dashboard export (security bug)
The dashboard CSV export quoted fields per RFC-4180 but did **not** neutralize
formula injection (CWE-1236): a cell starting with `= + - @` tab/CR is executed
as a formula by Excel/Sheets. Product names are admin-controlled free text and
flow into the "Produit" column, so a product named e.g. `=HACK()` exported raw
(`,=HACK(),`) — verified by reading the generated CSV.

- **Fix** (`Dashboard.tsx`): `csvEscape` now prefixes a `'` for non-numeric
  cells starting with a dangerous char (numeric cells, incl. negatives, are
  untouched). PDF export is unaffected (not formula-evaluated).
- **Coverage** (`dashboard.spec.ts`): export with a `=HACK()` product name; the
  downloaded CSV must contain `'=HACK()` and never a raw `,=HACK`.

Suite is now **55 tests**.

## Loop 8 — PDF export of an empty period rendered "NaN %" (bug)
The PDF button was gated only on `pdfLoading`, and `exportPdf` (unlike
`exportCsv`) didn't guard empty data. `PdfReport` divides every time-band by
`total.tT`, so exporting a period with no data (tT 0) produced a report full of
"NaN %" cells. **Fix** (`Dashboard.tsx`): `exportPdf` now blocks empty periods
with the same "Aucune donnée à exporter" toast as CSV. **Coverage**
(`dashboard.spec.ts`): PDF on an empty period shows the message and generates no
download. Suite is now **56 tests**.

## Loop 9 — finish the window.confirm → modal migration (a11y/consistency)
The Admin **Users** panel still deactivated users via `window.confirm` while
every other panel uses the accessible `ConfirmDeleteModal` (LOOP_STATE had
recorded this migration as done — Users was missed). `window.confirm` is
unstyleable, not focus-managed, and effectively untestable. Migrated
deactivation to the shared `useConfirmDelete` modal (reactivation stays
immediate). Added admin tests: deactivation opens the modal + Escape closes it;
confirming PATCHes `isActive:false`. Suite is now **58 tests**.

## Loop 10 — reset-password modal had the same focus/Escape bug (a11y)
The Admin reset-password modal (`role="dialog" aria-modal` + Escape handler) had
no focus management — focus stayed on the key button outside the overlay, so
Escape did nothing and keyboard users were stranded (same defect class fixed in
loop 3 for ConfirmDeleteModal). Verified empirically (modal stayed open; active
element was the key button). **Fix** (`Admin.tsx`): focus the dialog's input on
open via a ref+effect. **Coverage** (`admin.spec.ts`): Escape closes the modal;
submitting a new password POSTs `{password}`. Suite is now **60 tests**.

## Loop 11 — Favourite quick-stops (new feature, front-first)
Admin marks up to **4 downtime categories as favourites** (★) in Paramètres →
Arrêts; the **operator main screen** shows them as one-tap chrono buttons (tap =
start timer, tap again = stop + record the downtime, rounded up to ≥1 min). Only
one runs at a time; the others dim while a chrono is active. Reuses the existing
downtime-category system (names + TRS/NF mapping already admin-managed).

- Frontend (`Compteur.tsx` `FavoritesQuickBar`, `Admin.tsx` star toggle max-4,
  `api.ts` `isFavorite`/`favoriteOrder` fields).
- Coverage (`favorites.spec.ts`): admin ★ toggle PATCHes `isFavorite`; operator
  bar shows favourites; tap→start→tap→records `POST …/downtimes`.
- **Backend pending (2nd pass):** add `isFavorite`/`favoriteOrder` to the
  `downtime_categories` schema + migration, accept them in the admin PATCH
  validator and return them from `/ref/downtime-categories`. Until then the UI is
  inert against the real API, so this stays on the branch (not merged to prod).

Suite is now **63 tests**.
