import { expect } from "vitest";
import type { SessionTrsResult } from "./index";

// Shared scaffolding for the E2E aggregation tests (deterministic year
// generation + canonical NF E 60-182 invariant checks). Not a *.test.ts file,
// so vitest does not collect it as a suite.

// Deterministic PRNG (mulberry32) with the small int/pick helpers bound to it.
export function makeRng(seed: number) {
  let s = seed;
  const next = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    rint: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(arr: T[]) => arr[Math.floor(next() * arr.length)],
  };
}

export const pad = (n: number) => String(n).padStart(2, "0");
export const addMinutes = (iso: string, m: number) =>
  new Date(new Date(iso).getTime() + m * 60_000).toISOString();

export const CADENCES: { cadence: number; unit: "u/min" | "u/h" }[] = [
  { cadence: 80, unit: "u/min" },
  { cadence: 100, unit: "u/min" },
  { cadence: 6000, unit: "u/h" }, // 100 u/min
  { cadence: 7200, unit: "u/h" }, // 120 u/min
];

// Every weekday (Mon–Fri) of the given year as "YYYY-MM-DD".
export function weekdaysOfYear(year: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(`${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Canonical NF E 60-182 identities, asserted at any aggregation level.
// `slack` (minutes) absorbs lot-duration rounding in the time cascade.
export function assertSessionInvariants(s: SessionTrsResult, label: string, slack = 0.6) {
  expect(s.tT + slack, `${label}: tT≥tO`).toBeGreaterThanOrEqual(s.tO);
  expect(s.tO + slack, `${label}: tO≥tR`).toBeGreaterThanOrEqual(s.tR);
  expect(s.tR + slack, `${label}: tR≥tF`).toBeGreaterThanOrEqual(s.tF);
  expect(s.tF + slack, `${label}: tF≥tN`).toBeGreaterThanOrEqual(s.tN);
  expect(s.tN + slack, `${label}: tN≥tU`).toBeGreaterThanOrEqual(s.tU);
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
