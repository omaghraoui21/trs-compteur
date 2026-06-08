import { describe, it, expect } from "vitest";
import {
  computeLotTrs,
  computeSessionTrs,
  computeZoomTrs,
  familleToNorme,
  type LotTrsResult,
  type SessionTrsResult,
} from "./index";
import { makeRng, addMinutes, CADENCES, weekdaysOfYear, assertSessionInvariants } from "./test-utils";

// ──────────────────────────────────────────────────────────────────────────
// E2E — a full year of PLANNED vs UNPLANNED stop management, including the
// ex-"phases" (nettoyage / vide_ligne / CHSB / remplissage) that are now folded
// into planned stops, lot transitions, and their distinct impact on TRS / TRG.
//
// Domain model exercised:
//   • Inter-lot phases  → session planned stops (tAP) → reduce tO→tR → hit TRG, protect TRS
//   • Lot réglage (planned) + panne (unplanned) + inter-lot attente (unplanned)
//                       → reduce tR→tF → hit DO (and TRS via foregone output)
//   • famille → NF E 60-182 norme classification is reporting-only (no math impact)
// ──────────────────────────────────────────────────────────────────────────

const { next: rnd, rint, pick } = makeRng(0x5705);

// Inter-lot transition phases (ex-"phases"), all PLANNED, with their famille.
const PHASES: { name: string; famille: string; min: () => number }[] = [
  { name: "vide_ligne",  famille: "Attente et transition", min: () => rint(5, 12) },
  { name: "nettoyage",   famille: "Nettoyage",             min: () => rint(15, 35) },
  { name: "CHSB",        famille: "Utilités",              min: () => rint(8, 20) },
  { name: "remplissage", famille: "Attente et transition", min: () => rint(5, 15) },
];

// NF E 60-182 family → norme code (reporting-only classification).
const FAMILLE_NORME: Record<string, string> = {
  "Attente et transition": "AI",
  "Nettoyage": "AP",
  "Utilités": "UE",
  "Contrôle qualité": "CQ",  // lot prélèvement (planned)
  "Panne équipement": "AB",  // lot breakdown (unplanned)
};

// A re-evaluable spec for one lot so the same year can be replayed under policies.
interface LotSpec {
  cadence: number; unit: "u/min" | "u/h";
  durationMin: number;
  reglageMin: number;   // planned lot stop  (famille "Contrôle qualité" — prélèvement)
  panneMin: number;     // unplanned lot stop (famille "Panne équipement")
  perf: number; q: number;
}
interface DaySpec {
  date: string;
  lots: LotSpec[];
  phaseMin: number;     // Σ inter-lot planned phases  → tAP
  attenteMin: number;   // inter-lot unplanned waiting → session unplanned
  bufferMin: number;    // "à classer" wall-clock
}

interface Policy { unplanned: boolean; plannedPhases: boolean }
const BASELINE: Policy = { unplanned: true, plannedPhases: true };

function buildDaySpec(date: string): DaySpec {
  const nLots = rint(1, 4);
  const lots: LotSpec[] = [];
  for (let i = 0; i < nLots; i++) {
    const c = pick(CADENCES);
    lots.push({
      cadence: c.cadence, unit: c.unit,
      durationMin: rint(90, 220),
      reglageMin: rnd() < 0.45 ? rint(8, 20) : 0,
      panneMin: rnd() < 0.55 ? rint(0, 28) : 0,
      perf: 0.70 + rnd() * 0.27,
      q: 0.90 + rnd() * 0.099,
    });
  }
  // Each lot transition (start-of-day + between lots) runs a couple of phases.
  let phaseMin = 0;
  for (let t = 0; t < nLots; t++) {
    const usePhases = [PHASES[0], PHASES[1], ...(rnd() < 0.5 ? [PHASES[2]] : []), ...(rnd() < 0.5 ? [PHASES[3]] : [])];
    for (const ph of usePhases) phaseMin += ph.min();
  }
  return { date, lots, phaseMin, attenteMin: rnd() < 0.5 ? rint(0, 18) : 0, bufferMin: rint(0, 12) };
}

// Evaluate a day spec under a policy. Returns the session result plus the exact
// stop buckets so the test can reconcile them.
function evalDay(spec: DaySpec, policy: Policy): {
  session: SessionTrsResult & { date: string };
  tAP: number; lotPlanned: number; lotUnplanned: number; sessionUnplanned: number;
} {
  const openedAt = `${spec.date}T05:00:00Z`;
  let cursor = openedAt, sumDuration = 0, lotPlanned = 0, lotUnplanned = 0;
  const lotResults: (LotTrsResult & { produced: number; conforming: number })[] = [];

  for (const ls of spec.lots) {
    const cadencePerMin = ls.unit === "u/min" ? ls.cadence : ls.cadence / 60;
    const reglage = ls.reglageMin;
    const panne = policy.unplanned ? ls.panneMin : 0;          // counterfactual: drop breakdowns
    const tF = Math.max(1, ls.durationMin - reglage - panne);
    // When breakdowns are removed the freed time produces more at the same perf/quality.
    const produced = Math.floor(cadencePerMin * tF * ls.perf);
    const conforming = Math.floor(produced * ls.q);

    const startedAt = cursor;
    const endedAt = addMinutes(startedAt, ls.durationMin);
    cursor = addMinutes(endedAt, 1);

    const downtimes = [
      ...(reglage > 0 ? [{ durationMinutes: reglage, isPlanned: true, famille: "Contrôle qualité" }] : []),
      ...(panne > 0 ? [{ durationMinutes: panne, isPlanned: false, famille: "Panne équipement" }] : []),
    ];
    const lot = computeLotTrs({ cadence: ls.cadence, cadenceUnit: ls.unit, produced, conforming, startedAt, endedAt, downtimes });
    expect(lot).not.toBeNull();
    lotResults.push({ ...(lot as LotTrsResult), produced, conforming });
    sumDuration += ls.durationMin; lotPlanned += reglage; lotUnplanned += panne;
  }

  const tAP = policy.plannedPhases ? spec.phaseMin : 0;
  const sessionUnplanned = policy.unplanned ? spec.attenteMin : 0;
  // tO covers lots + planned phases (when declared) + attente + buffer. When phases
  // are NOT declared planned, the machine simply isn't opened for them → tO shrinks.
  const tO = sumDuration + tAP + spec.attenteMin + spec.bufferMin;
  const closedAt = addMinutes(openedAt, tO);

  const session = computeSessionTrs({ openedAt, closedAt, plannedStopsMin: tAP, unplannedStopsMin: sessionUnplanned, lots: lotResults });
  return { session: { date: spec.date, ...session }, tAP, lotPlanned, lotUnplanned, sessionUnplanned };
}

describe("E2E — planned/unplanned stops, ex-phases & lot transitions over a year", () => {
  // One shared set of day specs and its baseline evaluation, reused by every test.
  const specs = weekdaysOfYear(2026).map(buildDaySpec);
  const baseEvals = specs.map(s => evalDay(s, BASELINE));
  const baseYear = computeZoomTrs({ sessions: baseEvals.map(e => e.session) });

  it("reconciles every stop bucket day by day and classifies ex-phases by norme", () => {
    for (const [famille, norme] of Object.entries(FAMILLE_NORME)) {
      expect(familleToNorme(famille), `${famille}→${norme}`).toBe(norme);
    }
    // Every ex-phase famille is a classified NF E 60-182 family.
    for (const ph of PHASES) expect(FAMILLE_NORME[ph.famille], `phase ${ph.name}`).toBeDefined();

    let errorWarnings = 0;
    for (const ev of baseEvals) {
      const s = ev.session;

      // (1) Planned phases (ex-phases) reduce tO→tR exactly.
      expect(s.tAP, `${s.date}: tAP=phaseMin`).toBe(ev.tAP);
      expect(s.tR, `${s.date}: tR=tO-tAP`).toBe(Math.max(0, s.tO - ev.tAP));

      // (2) Lot réglage + all unplanned reduce tR→tF exactly (NF E 60-182 §2.2.6).
      const reduceToTf = ev.lotPlanned + ev.lotUnplanned + ev.sessionUnplanned;
      expect(s.tF, `${s.date}: tF=tR-arrets`).toBe(Math.max(0, s.tR - reduceToTf));
      expect(s.audit.tF_norme, `${s.date}: audit tF`).toBe(s.tF);
      expect(s.totalUnplannedMin, `${s.date}: ΣNP`).toBe(ev.lotUnplanned + ev.sessionUnplanned);

      // (3) famille classification (lot-level) reconciles and maps to the right norme.
      const famSum = Object.values(s.downtimeByFamille).reduce((a, b) => a + b, 0);
      expect(famSum, `${s.date}: Σfamille=lot downtime`).toBe(ev.lotPlanned + ev.lotUnplanned);
      if (ev.lotUnplanned > 0) expect(s.downtimeByNorme["AB"], `${s.date}: AB`).toBe(ev.lotUnplanned);
      if (ev.lotPlanned > 0) expect(s.downtimeByNorme["CQ"], `${s.date}: CQ`).toBe(ev.lotPlanned);

      errorWarnings += s.warnings.filter(w => w.level === "error").length;
    }
    expect(errorWarnings, "no error-level coherence violations").toBe(0);
  });

  it("places ex-phases exactly in the TRS↔TRG wedge over the year", () => {
    const year = baseYear;

    // TRG = TRS · (tR/tO); the planned-phase loss share is exactly tAP/tO.
    expect(year.TRG).toBeCloseTo(year.TRS * (year.tR / year.tO), 9);
    if (year.TRS > 0) {
      expect((year.TRS - year.TRG) / year.TRS, "phase loss share = tAP/tO").toBeCloseTo(year.tAP / year.tO, 9);
    }
    // DO captures lot-planned + unplanned losses: DO = tF/tR.
    expect(year.DO).toBeCloseTo(year.tF / year.tR, 9);
    // Planned phases (tAP) are excluded from tR, so they do NOT enter DO.
    expect(year.tR).toBeCloseTo(year.tO - year.tAP, 6);
  });

  it("quantifies the distinct TRS/TRG impact via controlled counterfactuals", () => {
    const base = baseYear;

    // A) Eliminate breakdowns (panne) → freed time produces more → TRS & TRG rise, DO rises.
    const noUnplanned = computeZoomTrs({ sessions: specs.map(s => evalDay(s, { unplanned: false, plannedPhases: true }).session) });
    expect(noUnplanned.totalUnplannedMin).toBe(0);
    expect(noUnplanned.DO).toBeGreaterThan(base.DO);
    expect(noUnplanned.TRS).toBeGreaterThan(base.TRS);
    expect(noUnplanned.TRG).toBeGreaterThan(base.TRG);
    expect(noUnplanned.tF).toBeGreaterThan(base.tF); // freed minutes added to net time

    // B) Stop declaring planned phases (machine not opened for them) → tR & TRS UNCHANGED,
    //    only TRG improves (smaller tO). Proves phases hit TRG, never TRS.
    const noPhases = computeZoomTrs({ sessions: specs.map(s => evalDay(s, { unplanned: true, plannedPhases: false }).session) });
    expect(noPhases.tAP).toBe(0);
    expect(noPhases.tR).toBeCloseTo(base.tR, 6);   // tR preserved
    expect(noPhases.tU).toBeCloseTo(base.tU, 6);   // output preserved
    expect(noPhases.TRS).toBeCloseTo(base.TRS, 9); // ← TRS strictly unchanged
    expect(noPhases.tO).toBeLessThan(base.tO);
    expect(noPhases.TRG).toBeGreaterThan(base.TRG); // ← only TRG moves

    // Every counterfactual is still internally coherent.
    for (const y of [base, noUnplanned, noPhases]) assertSessionInvariants(y, "counterfactual");
  });
});
