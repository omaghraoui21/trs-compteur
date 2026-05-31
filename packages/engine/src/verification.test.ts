import { describe, it, expect } from "vitest";
import {
  computeLotTrs,
  computeSessionTrs,
  computeZoomTrs,
  groupSessionsByPeriod,
  type LotTrsResult,
  type SessionTrsResult,
} from "./trs";

// ════════════════════════════════════════════════════════════════════
// NF E 60-182 VERIFICATION AUDIT
// Property-based + edge-case proof that every TRS/TRG value the engine
// produces obeys the standard's identities and ordering invariants.
//
// Reference cascade (NF E 60-182):
//   tT ≥ tO ≥ tR ≥ tF ≥ tN ≥ tU         (time cascade)
//   DO = tF/tR   TP = tN/tF   TQ = tU/tN
//   TRS = tU/tR = DO·TP·TQ               (synthetic, vs required time)
//   TRG = tU/tO                          (global, vs opening time)
//   TEEP = tU/tT                         (economic, vs calendar time)
//   ⇒ TEEP ≤ TRG ≤ TRS                   (denominators shrink)
// ════════════════════════════════════════════════════════════════════

const EPS = 1e-9;

// Deterministic PRNG so the audit is reproducible.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRandomSession(rnd: () => number, opts: { singleCadence?: boolean } = {}): SessionTrsResult {
  // Random but internally consistent shift: opening 1–14h, planned 0–25% of tO.
  const tOpenH = 1 + rnd() * 13;
  const openedAt = new Date("2026-05-01T06:00:00Z");
  const closedAt = new Date(openedAt.getTime() + tOpenH * 3600_000);
  const tO = Math.round(tOpenH * 60);
  const plannedStopsMin = Math.round(tO * rnd() * 0.25);

  const lotCount = 1 + Math.floor(rnd() * 4);
  const lots: (LotTrsResult & { produced: number; conforming: number })[] = [];
  let cursor = new Date(openedAt.getTime() + plannedStopsMin * 60_000);
  const fixedCadence = 50 + Math.round(rnd() * 200); // shared when singleCadence

  const tRapprox = tO - plannedStopsMin;
  for (let i = 0; i < lotCount; i++) {
    const remainingMin = Math.max(10, (tRapprox / lotCount));
    const lotMin = Math.max(5, Math.round(remainingMin * (0.5 + rnd() * 0.5)));
    const start = new Date(cursor);
    const end = new Date(start.getTime() + lotMin * 60_000);
    cursor = end;

    const cadence = opts.singleCadence ? fixedCadence : 50 + Math.round(rnd() * 200); // u/min
    const unplanned = Math.round(rnd() * lotMin * 0.3);
    const plannedLot = Math.round(rnd() * lotMin * 0.1);
    const lot = computeLotTrs({
      cadence,
      cadenceUnit: "u/min",
      // produce at ≤ cadence so TP ≤ 1, conforming ≤ produced so TQ ≤ 1
      produced: Math.round(cadence * Math.max(0, lotMin - unplanned - plannedLot) * (0.6 + rnd() * 0.4)),
      conforming: 0, // set below
      startedAt: start,
      endedAt: end,
      downtimes: [
        ...(unplanned > 0 ? [{ durationMinutes: unplanned, isPlanned: false, famille: "Panne équipement" }] : []),
        ...(plannedLot > 0 ? [{ durationMinutes: plannedLot, isPlanned: true, famille: "Nettoyage" }] : []),
      ],
    })!;
    // Recompute with conforming ≤ produced
    const produced = lot.tN * lot.cadencePerMin; // == original produced
    const conforming = Math.round(produced * (0.9 + rnd() * 0.1));
    const fixed = computeLotTrs({
      cadence,
      cadenceUnit: "u/min",
      produced: Math.round(produced),
      conforming,
      startedAt: start,
      endedAt: end,
      downtimes: [
        ...(unplanned > 0 ? [{ durationMinutes: unplanned, isPlanned: false, famille: "Panne équipement" }] : []),
        ...(plannedLot > 0 ? [{ durationMinutes: plannedLot, isPlanned: true, famille: "Nettoyage" }] : []),
      ],
    })!;
    lots.push({ ...fixed, produced: Math.round(produced), conforming });
  }

  return computeSessionTrs({ openedAt, closedAt, plannedStopsMin, lots });
}

// ─── Shared invariant assertions ────────────────────────────────────

function assertSessionInvariants(s: SessionTrsResult, opts: { homogeneousCadence?: boolean } = {}) {
  // 1. Time cascade: tT ≥ tO ≥ tR ≥ tF ≥ tN ≥ tU  (allow tiny FP slack)
  expect(s.tT + EPS).toBeGreaterThanOrEqual(s.tO);
  expect(s.tO + EPS).toBeGreaterThanOrEqual(s.tR);
  expect(s.tR + 0.5).toBeGreaterThanOrEqual(s.tF); // rounding of lot minutes
  // tN ≤ tF only holds when TP ≤ 1 (produced ≤ capacity) — our generator guarantees it
  expect(s.tF + 0.5).toBeGreaterThanOrEqual(s.tN);
  expect(s.tN + EPS).toBeGreaterThanOrEqual(s.tU);

  // 2. tR = tO − tAP
  expect(s.tR).toBeCloseTo(Math.max(0, s.tO - s.tAP), 6);

  // 3. All rates within [0, 1] (+slack)
  for (const r of [s.DO, s.TP, s.TQ, s.TRS, s.TRG, s.TEEP!]) {
    expect(r).toBeGreaterThanOrEqual(-EPS);
    expect(r).toBeLessThanOrEqual(1 + 1e-6);
  }

  // 4. CANONICAL DEFINITIONS (NF E 60-182) — these ALWAYS hold exactly:
  //    TRS = tU/tR, TRG = tU/tO, TEEP = tU/tT.
  if (s.tR > 0) expect(s.TRS).toBeCloseTo(s.tU / s.tR, 9);
  if (s.tO > 0) expect(s.TRG).toBeCloseTo(s.tU / s.tO, 9);
  if (s.tT > 0) expect(s.TEEP!).toBeCloseTo(s.tU / s.tT, 9);

  // 5. Component definitions
  if (s.tR > 0) expect(s.DO).toBeCloseTo(s.tF / s.tR, 9);
  if (s.tF > 0) expect(s.TP).toBeCloseTo(s.tN / s.tF, 9);
  if (s.totalProduced > 0) expect(s.TQ).toBeCloseTo(s.totalConforming / s.totalProduced, 9);

  // 6. THREE-FACTOR DECOMPOSITION: TRS = DO·TP·TQ.
  //    Exact only when cadence is homogeneous across lots. With mixed
  //    cadences the piece-count TQ (Σconf/Σprod) is weighted differently than
  //    the cadence-built times, so the product is an approximation — and the
  //    engine flags it via the TRS_PRODUCT_MISMATCH warning. We assert exact
  //    equality only for homogeneous sessions; otherwise a small bound.
  if (s.tR > 0) {
    const product = s.DO * s.TP * s.TQ;
    if (opts.homogeneousCadence) {
      expect(s.TRS).toBeCloseTo(product, 9);
    } else {
      expect(Math.abs(s.TRS - product)).toBeLessThan(0.05); // ≤ 5pp, documented
    }
  }

  // 7. Denominator ordering ⇒ TEEP ≤ TRG ≤ TRS
  expect(s.TRG).toBeLessThanOrEqual(s.TRS + 1e-6);
  expect(s.TEEP!).toBeLessThanOrEqual(s.TRG + 1e-6);

  // 8. TRG = TRS · (tR/tO)  (decomposition of the planned-stop loss)
  if (s.tO > 0 && s.tR > 0) {
    expect(s.TRG).toBeCloseTo(s.TRS * (s.tR / s.tO), 9);
  }
}

describe("NF E 60-182 verification audit — randomized property tests", () => {
  it("holds all canonical invariants over 2000 random multi-cadence sessions", () => {
    const rnd = mulberry32(20260531);
    for (let i = 0; i < 2000; i++) {
      assertSessionInvariants(buildRandomSession(rnd));
    }
  });

  it("TRS = DO·TP·TQ EXACTLY over 2000 single-cadence sessions", () => {
    const rnd = mulberry32(424242);
    for (let i = 0; i < 2000; i++) {
      assertSessionInvariants(buildRandomSession(rnd, { singleCadence: true }), { homogeneousCadence: true });
    }
  });

  it("zoom aggregation reconciles with the sum of its sessions", () => {
    const rnd = mulberry32(7);
    for (let trial = 0; trial < 200; trial++) {
      const sessions = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => buildRandomSession(rnd));
      const zoom = computeZoomTrs({ sessions });

      // Additive bases sum exactly
      expect(zoom.tU).toBeCloseTo(sessions.reduce((s, x) => s + x.tU, 0), 6);
      expect(zoom.tR).toBeCloseTo(sessions.reduce((s, x) => s + x.tR, 0), 6);
      expect(zoom.tO).toBeCloseTo(sessions.reduce((s, x) => s + x.tO, 0), 6);

      // Aggregate TRS/TRG = Σtu / Σtr (Σto), not a naive mean
      if (zoom.tR > 0) expect(zoom.TRS).toBeCloseTo(zoom.tU / zoom.tR, 9);
      if (zoom.tO > 0) expect(zoom.TRG).toBeCloseTo(zoom.tU / zoom.tO, 9);
      assertSessionInvariants(zoom);
    }
  });

  it("day → week → month grouping reconciles (associativity)", () => {
    const rnd = mulberry32(99);
    const sessions = Array.from({ length: 40 }, (_, i) => {
      const s = buildRandomSession(rnd);
      const day = String((i % 28) + 1).padStart(2, "0");
      return { ...s, date: `2026-05-${day}` };
    });

    const total = computeZoomTrs({ sessions });
    for (const by of ["day", "week", "month"] as const) {
      const buckets = groupSessionsByPeriod(sessions, by);
      const tU = buckets.reduce((s, b) => s + b.tU, 0);
      const tR = buckets.reduce((s, b) => s + b.tR, 0);
      const tO = buckets.reduce((s, b) => s + b.tO, 0);
      expect(tU).toBeCloseTo(total.tU, 4);
      expect(tR).toBeCloseTo(total.tR, 4);
      expect(tO).toBeCloseTo(total.tO, 4);
      // Reconstructed global TRS from buckets equals direct total
      if (tR > 0) expect(tU / tR).toBeCloseTo(total.TRS, 9);
    }
  });
});

describe("NF E 60-182 verification audit — boundary cases", () => {
  it("zero opening time yields all-zero rates (no NaN/Infinity)", () => {
    const s = computeSessionTrs({
      openedAt: "2026-05-01T06:00:00Z",
      closedAt: "2026-05-01T06:00:00Z",
      plannedStopsMin: 0,
      lots: [],
    });
    for (const r of [s.DO, s.TP, s.TRS, s.TRG, s.TEEP!, s.utilisation!]) {
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBe(0);
    }
    expect(s.TQ).toBe(1); // quality of nothing is conventionally 100%
  });

  it("perfect run: TRS = TRG when there are no planned stops (tR = tO)", () => {
    // One lot, no downtime, produced == capacity, all conforming
    const start = "2026-05-01T06:00:00Z";
    const end = "2026-05-01T14:00:00Z"; // 480 min
    const cadence = 100; // u/min → capacity 48000 over 480 min
    const lot = computeLotTrs({
      cadence, cadenceUnit: "u/min",
      produced: 48000, conforming: 48000,
      startedAt: start, endedAt: end, downtimes: [],
    })!;
    const s = computeSessionTrs({
      openedAt: start, closedAt: end, plannedStopsMin: 0,
      lots: [{ ...lot, produced: 48000, conforming: 48000 }],
    });
    expect(s.tAP).toBe(0);
    expect(s.tR).toBe(s.tO);
    expect(s.TRS).toBeCloseTo(s.TRG, 9); // tR == tO ⇒ identical
    expect(s.TRS).toBeCloseTo(1, 6);     // perfect
    expect(s.DO).toBeCloseTo(1, 6);
    expect(s.TP).toBeCloseTo(1, 6);
    expect(s.TQ).toBeCloseTo(1, 6);
  });

  it("mixed-cadence session: TRS = tU/tR exactly, and the engine flags the DO·TP·TQ gap", () => {
    // Two lots, very different cadences and quality — the worst case for the
    // three-factor decomposition. TRS (canonical) must still be exact.
    const fast = computeLotTrs({
      cadence: 200, cadenceUnit: "u/min", produced: 40000, conforming: 39800,
      startedAt: "2026-05-01T06:00:00Z", endedAt: "2026-05-01T10:00:00Z", downtimes: [],
    })!;
    const slow = computeLotTrs({
      cadence: 50, cadenceUnit: "u/min", produced: 10000, conforming: 8000,
      startedAt: "2026-05-01T10:00:00Z", endedAt: "2026-05-01T14:00:00Z", downtimes: [],
    })!;
    const s = computeSessionTrs({
      openedAt: "2026-05-01T06:00:00Z", closedAt: "2026-05-01T14:00:00Z", plannedStopsMin: 0,
      lots: [{ ...fast, produced: 40000, conforming: 39800 }, { ...slow, produced: 10000, conforming: 8000 }],
    });
    // Canonical definition is always exact
    expect(s.TRS).toBeCloseTo(s.tU / s.tR, 9);
    // Piece-count TQ vs time-weighted tU/tN differ ⇒ decomposition not exact
    const product = s.DO * s.TP * s.TQ;
    expect(Math.abs(s.TRS - product)).toBeGreaterThan(0.001);
    // ...and the engine self-documents the divergence
    expect(s.warnings.some(w => w.code === "TRS_PRODUCT_MISMATCH")).toBe(true);
  });

  it("planned stops drive a strict TRG < TRS gap", () => {
    const start = "2026-05-01T06:00:00Z";
    const end = "2026-05-01T14:00:00Z"; // 480 min open
    const cadence = 100;
    // 60 min planned shift stop ⇒ tR = 420
    const lot = computeLotTrs({
      cadence, cadenceUnit: "u/min",
      produced: 42000, conforming: 42000,
      startedAt: "2026-05-01T07:00:00Z", endedAt: end, // 420 min running
      downtimes: [],
    })!;
    const s = computeSessionTrs({
      openedAt: start, closedAt: end, plannedStopsMin: 60,
      lots: [{ ...lot, produced: 42000, conforming: 42000 }],
    });
    expect(s.tR).toBe(420);
    expect(s.tO).toBe(480);
    expect(s.TRS).toBeGreaterThan(s.TRG);                 // strict
    expect(s.TRG).toBeCloseTo(s.TRS * (420 / 480), 9);    // exact ratio
  });
});
