# NEXT_GOAL_PROMPT.md — TRS Compteur

**Context for next session (picks up from claude/new-session-29dl2)**

## What Was Built

TRS Compteur is a pharmaceutical OEE tracking app (NF E 60-182, GMP Annex 11, 21 CFR Part 11). The codebase is a pnpm monorepo:
- `@trs/engine` — pure TS TRS math, 63 Vitest tests
- `@trs/api` — Express.js REST API
- `@trs/web` — React 19 + Vite + Tailwind
- `api/handler.mjs` — Vercel serverless bundle (must rebuild after API changes)

**Production branch:** `devin/1779664896-initial-app` (what Vercel deploys)  
**Feature branch:** `claude/new-session-29dl2`

## State After Last Wave

All top-priority improvements are done:
- Accessibility: all form labels linked, ARIA regions, dialog attrs, focus rings
- Validation: batch format, uniqueness warning, cadence range, duration bounds
- PDF: duration formatting, notes, signature block, flexWrap
- Supervisor: correction flow (21 CFR), status tabs, enriched lot cards, session notes
- Dashboard: delta arrows, production summary strip, comparison date label
- Duration formatting: consistent fmtDuration() everywhere

## Top Remaining Improvements

1. **Compteur: running session total strip** — show "3 lots · 12,500 pièces · DO 87%" as a live strip above the closed lots section (operator feedback during shift). Add `useMemo` computing totals from `detail.lots.filter(l => l.status !== "active")`.

2. **Dashboard: add date range to comparison KpiCard** — when `showComparison` is on, each KpiCard shows the date range in a smaller subtitle under the equipment name. The `from`/`to` dates are available in scope.

3. **PDF: add equipment code to header** — change `{equipmentName}` to `{equipmentName} ({equipmentCode})` in the PDF Document title. Requires adding `equipmentCode` prop to PdfReport component and passing it from Dashboard.tsx exportPdf() function. The equipment code is in `eq?.code` from `equipmentsList`.

4. **Compteur: session close-of-shift refinements** — after closing a session, show a summary overlay (lots count, total pièces, TRS achieved vs objective) before returning to idle. Currently just resets to no-session state.

5. **Admin: keyboard Tab order** — when FormCard is open, ensure Tab sequence goes through all FormCard fields before reaching the table below.

## Files to Focus On

| File | What to change |
|------|---------------|
| packages/web/src/pages/Compteur.tsx | Session totals strip (near line 605) |
| packages/web/src/pages/Dashboard.tsx | Comparison KpiCard subtitle (~line 318) |
| packages/web/src/components/dashboard/PdfReport.tsx | equipmentCode prop (~line 30) |

## Commands

```bash
pnpm typecheck              # must pass 0 errors
pnpm --filter @trs/engine test   # must pass 63 tests
node scripts/build-api.mjs  # rebuild only if API changed
git push origin HEAD:claude/new-session-29dl2
```

## Security

NEVER commit: Vercel token, Railway token, Railway DB URL.
