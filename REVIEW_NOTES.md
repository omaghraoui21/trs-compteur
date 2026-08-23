# REVIEW_NOTES.md — TRS Compteur

**Review date:** 2026-06-14 (wave 2)  
**Reviewer role:** QA + Industrial Production Manager

---

## UI/UX Review

### ✅ Fixed This Wave
- All Admin form labels properly linked via `htmlFor`/`id` (roles, rooms, types, cadence units, famille, équipement cible, audit filters)
- Dashboard zoom tabs: per-button `focus-visible:ring` for keyboard navigation
- Dashboard Comparer: `aria-pressed` toggle feedback
- NewLotForm: all form fields have `htmlFor`/`id`
- Supervisor comment input: `htmlFor`, `aria-invalid`, `role="alert"` on error message
- Compteur timeline bar: `role="region"` + `aria-label`

### ✅ Previously Fixed
- Large touch targets (min-h 60-64px)
- Clear color semantics: green = active/valid, amber = warning, red = error
- Toast system: dependency-free, auto-dismisses, aria-label on close button
- Supervisor correction flow with inline validation
- No-session state: info card + CTA

### ⚠️ Remaining Issues
1. **Tab order in Admin forms**: When editing, the focus goes from fields inside FormCard to unrelated elements outside. Minor.
2. **Dashboard comparison date context**: When `showComparison` is on (cross-equipment grid), the date range is shown in the filter bar only — not in each KpiCard's title.

---

## Data Validation Review

### ✅ Fixed
- Batch number: auto-uppercased, regex validated, 30 char max
- Batch number **uniqueness**: amber warning when re-using a previous session batch
- Conforming > Produced: blocked at client + server (Zod `refine`)
- Cadence absolute range: warn if >5000 u/min or >300,000 u/h
- Cadence deviation > 20%: warning + confirmation step
- Downtime duration: `min="1"` + `max="1440"` + inline errors + submit disabled
- Admin `Field` component: `htmlFor/id` linked

### ✅ All REVIEW_NOTES gaps now closed
No remaining validation gaps identified.

---

## PDF / Report Review

### ✅ All Fixed
- TOTAL row tR: formatted as `dur(Math.round(total.tR))`
- Time buckets: "Durée" column with formatted durations, % of tT column, hierarchy indented
- Daily notes (📝) appear under each day row
- Six big losses section uses `dur()` for all duration values
- GMP signature block: 3-column (Rédigé / Vérifié / Approuvé), footer says "Confidentiel"
- `cellLeft`: `flexWrap: "wrap"` prevents long product names from overflowing

### ⚠️ Minor Remaining
1. **PDF header**: No equipment code, just name. Equipment code would help identify reports.

---

## GMP / Industrial Logic Review

### ✅ Correct
- Electronic signature (21 CFR Part 11) on validation/rejection/correction
- Audit trail: actorId, actorEmail, action, entityId, payload, IP, timestamp
- TRS formula: NF E 60-182 compliant — DO × TP × TQ = tU/tR verified by 63 unit tests
- Correction reason mandatory + saved in audit payload
- Session notes from end-of-shift visible to supervisor in lot detail

### ⚠️ Minor
1. **Signature password field**: Sent as plaintext in JSON over HTTPS. Acceptable but UI could note "used for re-authentication only".

---

## Duration Formatting Consistency

### ✅ All Fixed
- `fmtDuration()` now used consistently everywhere (was mixing raw `n min`)
- Dashboard DailyTable: rebut uses `toLocaleString("fr-FR")` like NPR
- Supervisor: downtime totals, lot error messages, individual downtime rows all use `fmtDuration`
- Compteur: timeline events, downtime list items all use `fmtDuration`

---

## Top Remaining Improvements (Priority Order)

1. **Compteur: running session total** — show "N lots clôturés, X pièces" in a small strip in the session view header (operator feedback)
2. **Dashboard comparison date context** — add `from → to` in the comparison KpiCard title
3. **PDF: equipment code in header** — add `(code)` after equipment name
4. **Supervisor: bulk validation** — select multiple lots for batch validate/reject (complex, future feature)
5. **Admin tab keyboard order** — review Tab order when FormCard is open
