import { describe, it, expect } from "vitest";
import {
  computeLotTrs,
  computeSessionTrs,
  computeZoomTrs,
  groupSessionsByPeriod,
  periodKey,
  type LotTrsResult,
  type SessionTrsResult,
} from "./index";

// ──────────────────────────────────────────────────────────────────────────
// E2E — a FULL YEAR (2026) of pharma production, deterministically generated,
// run through the engine day by day, then aggregated day → week → month → year.
// Verifies every canonical NF E 60-182 identity at every level AND that no
// rounding drift accumulates over ~250 sessions / ~600 lots.
// ──────────────────────────────────────────────────────────────────────────

// Deterministic PRNG (mulberry32) so the year is reproducible.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260101);
const rint = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

const CADENCES: { cadence: number; unit: "u/min" | "u/h" }[] = [
  { cadence: 80, unit: "u/min" },
  { cadence: 100, unit: "u/min" },
  { cadence: 6000, unit: "u/h" },   // 100 u/min
  { cadence: 7200, unit: "u/h" },   // 120 u/min
];

function pad(n: number) { return String(n).padStart(2, "0"); }
function addMinIso(base: string, min: number) {
  return new Date(new Date(base).getTime() + min * 60_000).toISOString();
}

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
    const endedAt = addMinIso(startedAt, duration);
    cursor = addMinIso(endedAt, rint(5, 20));            // inter-lot gap

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
  const closedAt = addMinIso(openedAt, tO);

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

// Canonical identity checks applied at every aggregation level.
function assertInvariants(s: SessionTrsResult, label: string) {
  const SLACK = 0.6;
  expect(s.tT + SLACK, `${label}: tT≥tO`).toBeGreaterThanOrEqual(s.tO);
  expect(s.tO + SLACK, `${label}: tO≥tR`).toBeGreaterThanOrEqual(s.tR);
  expect(s.tR + SLACK, `${label}: tR≥tF`).toBeGreaterThanOrEqual(s.tF);
  expect(s.tF + SLACK, `${label}: tF≥tN`).toBeGreaterThanOrEqual(s.tN);
  expect(s.tN + SLACK, `${label}: tN≥tU`).toBeGreaterThanOrEqual(s.tU);
  if (s.tR > 0) expect(s.TRS, `${label}: TRS=tU/tR`).toBeCloseTo(s.tU / s.tR, 9);
  if (s.tO > 0) expect(s.TRG, `${label}: TRG=tU/tO`).toBeCloseTo(s.tU / s.tO, 9);
  if (s.tT > 0) expect(s.TEEP!, `${label}: TEEP=tU/tT`).toBeCloseTo(s.tU / s.tT, 9);
  if (s.tR > 0) expect(s.DO, `${label}: DO=tF/tR`).toBeCloseTo(s.tF / s.tR, 9);
  if (s.tF > 0) expect(s.TP, `${label}: TP=tN/tF`).toBeCloseTo(s.tN / s.tF, 9);
  if (s.tO > 0 && s.tR > 0) expect(s.TRG, `${label}: TRG=TRS·tR/tO`).toBeCloseTo(s.TRS * (s.tR / s.tO), 9);
  for (const r of [s.DO, s.TP, s.TQ, s.TRS, s.TRG, s.TEEP!, s.utilisation!]) {
    expect(Number.isFinite(r), `${label}: finite`).toBe(true);
    expect(r, `${label}: ≥0`).toBeGreaterThanOrEqual(-1e-6);
    expect(r, `${label}: ≤1`).toBeLessThanOrEqual(1 + 1e-6);
  }
}

describe("E2E — a full year (2026) of TRS/TRG aggregation", () => {
  it("reconciles day → week → month → year with no rounding drift", () => {
    // ── Generate every weekday of 2026 (Mon–Fri). ──
    const sessions: (SessionTrsResult & { date: string })[] = [];
    let totalLots = 0, errorWarnings = 0;
    const d = new Date(Date.UTC(2026, 0, 1));
    while (d.getUTCFullYear() === 2026) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        const day = buildDay(date);
        assertInvariants(day, date);
        errorWarnings += day.warnings.filter(w => w.level === "error").length;
        totalLots += day.lotCount;
        sessions.push(day);
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }

    // ~260 weekdays in a year; sanity-check we actually built a full year.
    expect(sessions.length).toBeGreaterThan(255);
    // Valid data → no error-level coherence violations should ever fire.
    expect(errorWarnings, "no error-level coherence violations on valid data").toBe(0);
    expect(totalLots).toBeGreaterThan(255);

    // ── Year total. ──
    const year = computeZoomTrs({ sessions });
    assertInvariants(year, "YEAR");

    // ── Aggregate at each granularity. ──
    const months = groupSessionsByPeriod(sessions, "month");
    const weeks = groupSessionsByPeriod(sessions, "week");
    const days = groupSessionsByPeriod(sessions, "day");

    expect(months.length, "12 months").toBe(12);
    expect(days.length, "one bucket per working day").toBe(sessions.length);

    // Each month bucket must itself satisfy every identity.
    for (const m of months) assertInvariants(m, `month ${m.periodKey}`);

    // ── ASSOCIATIVITY / NO DRIFT: every granularity must sum to the SAME year. ──
    for (const [label, buckets] of [["month", months], ["week", weeks], ["day", days]] as const) {
      const tU = buckets.reduce((s, b) => s + b.tU, 0);
      const tR = buckets.reduce((s, b) => s + b.tR, 0);
      const tO = buckets.reduce((s, b) => s + b.tO, 0);
      const tT = buckets.reduce((s, b) => s + b.tT, 0);
      expect(tU, `${label}: Σtu = year tU`).toBeCloseTo(year.tU, 6);
      expect(tR, `${label}: ΣtR = year tR`).toBeCloseTo(year.tR, 6);
      expect(tO, `${label}: ΣtO = year tO`).toBeCloseTo(year.tO, 6);
      expect(tT, `${label}: ΣtT = year tT`).toBeCloseTo(year.tT, 6);
      // The weighted TRS/TRG rebuilt from the buckets must equal the year exactly.
      expect(tU / tR, `${label}: rebuilt TRS = year TRS`).toBeCloseTo(year.TRS, 9);
      expect(tU / tO, `${label}: rebuilt TRG = year TRG`).toBeCloseTo(year.TRG, 9);
    }

    // ── Year identities exact. ──
    expect(year.TRS).toBeCloseTo(year.tU / year.tR, 9);
    expect(year.TRG).toBeCloseTo(year.tU / year.tO, 9);
    expect(year.TRG).toBeCloseTo(year.TRS * (year.tR / year.tO), 9);
  });
});
