import { describe, it, expect } from "vitest";
import {
  computeLotTrs,
  computeSessionTrs,
  computeZoomTrs,
  groupSessionsByPeriod,
  type GroupBy,
  type LotTrsResult,
  type PeriodBucket,
  type SessionTrsResult,
} from "./index";
import { makeRng, addMinutes, CADENCES, weekdaysOfYear, assertSessionInvariants } from "./test-utils";

// ──────────────────────────────────────────────────────────────────────────
// E2E — a FULL YEAR (2026) of pharma production, deterministically generated,
// run through the engine day by day, then aggregated day → week → month → year.
// Verifies every canonical NF E 60-182 identity at every level AND that no
// rounding drift accumulates over ~250 sessions / ~600 lots.
// ──────────────────────────────────────────────────────────────────────────

const { next: rnd, rint, pick } = makeRng(20260101);

// Build one production day. Lots are laid out so their wall-clock durations +
// all stops + a small "à classer" buffer exactly fill the open window — this
// keeps the time cascade tT≥tO≥tR≥tF≥tN≥tU valid by construction while still
// exercising mixed cadences, planned/unplanned stops and quality rejects.
function buildDay(date: string): SessionTrsResult & { date: string } {
  const openedAt = `${date}T05:00:00Z`;
  const nLots = rint(1, 4);
  const lotResults: (LotTrsResult & { produced: number; conforming: number })[] = [];

  let sumDuration = 0;
  let cursor = openedAt;

  for (let i = 0; i < nLots; i++) {
    const { cadence, unit } = pick(CADENCES);
    const cadencePerMin = unit === "u/min" ? cadence : cadence / 60;
    const duration = rint(90, 220);
    const planned = rnd() < 0.4 ? rint(8, 20) : 0;       // réglage/format
    const unplanned = rnd() < 0.6 ? rint(0, 25) : 0;     // panne/micro-arrêt
    const tF = Math.max(1, duration - planned - unplanned);
    const perf = 0.70 + rnd() * 0.27;                    // 70–97% → TP ≤ 1
    const produced = Math.floor(cadencePerMin * tF * perf);
    const q = 0.90 + rnd() * 0.099;                      // 90–99.9% conforming
    const conforming = Math.floor(produced * q);

    const startedAt = cursor;
    const endedAt = addMinutes(startedAt, duration);
    cursor = addMinutes(endedAt, rint(5, 20));           // inter-lot gap

    const downtimes = [
      ...(planned > 0 ? [{ durationMinutes: planned, isPlanned: true, famille: "reglage" }] : []),
      ...(unplanned > 0 ? [{ durationMinutes: unplanned, isPlanned: false, famille: "panne" }] : []),
    ];
    const lot = computeLotTrs({ cadence, cadenceUnit: unit, produced, conforming, startedAt, endedAt, downtimes });
    expect(lot, `${date} lot ${i}`).not.toBeNull();
    const L = lot as LotTrsResult;
    lotResults.push({ ...L, produced, conforming });
    sumDuration += duration;
  }

  const sessionPlanned = rint(20, 45);     // tAP — nettoyage / pause (inter-lot)
  const sessionUnplanned = rint(0, 20);    // attente sans lot actif
  const buffer = rint(0, 15);              // "à classer" — temps mural non couvert
  const tO = sumDuration + sessionPlanned + sessionUnplanned + buffer;
  const closedAt = addMinutes(openedAt, tO);

  return {
    date,
    ...computeSessionTrs({
      openedAt, closedAt,
      plannedStopsMin: sessionPlanned,
      unplannedStopsMin: sessionUnplanned,
      lots: lotResults,
    }),
  };
}

// Buckets at any granularity must sum back to the year totals, and the TRS/TRG
// rebuilt from them must equal the year exactly — i.e. aggregation is a weighted
// Σtu/Σtr with no rounding drift.
function assertBucketsReconcile(buckets: PeriodBucket[], year: SessionTrsResult, label: GroupBy) {
  const sum = (f: (b: PeriodBucket) => number) => buckets.reduce((s, b) => s + f(b), 0);
  const tU = sum(b => b.tU), tR = sum(b => b.tR), tO = sum(b => b.tO), tT = sum(b => b.tT);
  expect(tU, `${label}: Σtu = year tU`).toBeCloseTo(year.tU, 6);
  expect(tR, `${label}: ΣtR = year tR`).toBeCloseTo(year.tR, 6);
  expect(tO, `${label}: ΣtO = year tO`).toBeCloseTo(year.tO, 6);
  expect(tT, `${label}: ΣtT = year tT`).toBeCloseTo(year.tT, 6);
  expect(tU / tR, `${label}: rebuilt TRS = year TRS`).toBeCloseTo(year.TRS, 9);
  expect(tU / tO, `${label}: rebuilt TRG = year TRG`).toBeCloseTo(year.TRG, 9);
}

describe("E2E — a full year (2026) of TRS/TRG aggregation", () => {
  it("reconciles day → week → month → year with no rounding drift", () => {
    // ── Generate every weekday of 2026 and validate each day. ──
    const sessions: (SessionTrsResult & { date: string })[] = [];
    let totalLots = 0, errorWarnings = 0;
    for (const date of weekdaysOfYear(2026)) {
      const day = buildDay(date);
      assertSessionInvariants(day, date);
      errorWarnings += day.warnings.filter(w => w.level === "error").length;
      totalLots += day.lotCount;
      sessions.push(day);
    }

    // ~260 weekdays in a year; sanity-check we actually built a full year.
    expect(sessions.length).toBeGreaterThan(255);
    // Valid data → no error-level coherence violations should ever fire.
    expect(errorWarnings, "no error-level coherence violations on valid data").toBe(0);
    expect(totalLots).toBeGreaterThan(255);

    // ── Year total. ──
    const year = computeZoomTrs({ sessions });
    assertSessionInvariants(year, "YEAR");

    // ── Aggregate at each granularity; every month bucket is itself coherent. ──
    const months = groupSessionsByPeriod(sessions, "month");
    const weeks = groupSessionsByPeriod(sessions, "week");
    const days = groupSessionsByPeriod(sessions, "day");

    expect(months.length, "12 months").toBe(12);
    expect(days.length, "one bucket per working day").toBe(sessions.length);
    for (const m of months) assertSessionInvariants(m, `month ${m.periodKey}`);

    // ── ASSOCIATIVITY / NO DRIFT: every granularity sums to the SAME year. ──
    assertBucketsReconcile(months, year, "month");
    assertBucketsReconcile(weeks, year, "week");
    assertBucketsReconcile(days, year, "day");

    // ── Year identities exact. ──
    expect(year.TRS).toBeCloseTo(year.tU / year.tR, 9);
    expect(year.TRG).toBeCloseTo(year.tU / year.tO, 9);
    expect(year.TRG).toBeCloseTo(year.TRS * (year.tR / year.tO), 9);
  });
});
