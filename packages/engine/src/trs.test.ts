import { describe, it, expect } from "vitest";
import { computeLotTrs, computeSessionTrs, computeZoomTrs, computeProductTrs, computeSixBigLosses, groupSessionsByPeriod, isoWeekKey, periodKey, familleToNorme, timeWeightedCadence } from "./trs";

describe("timeWeightedCadence", () => {
  const start = new Date("2026-06-01T08:00:00Z");
  const end = new Date("2026-06-01T10:00:00Z"); // 120 min

  it("returns initial when there are no changes", () => {
    expect(timeWeightedCadence({ startedAt: start, endedAt: end, initial: 120, changes: [] })).toBe(120);
  });

  it("weights segments by their duration", () => {
    // 60 min @120 then 60 min @60 → mean 90
    const r = timeWeightedCadence({
      startedAt: start, endedAt: end, initial: 120,
      changes: [{ at: new Date("2026-06-01T09:00:00Z"), cadencePerMin: 60 }],
    });
    expect(r).toBeCloseTo(90, 6);
  });

  it("ignores changes outside the lot window and handles multiple changes", () => {
    // 30@100, 30@200, 60@50 → (30*100+30*200+60*50)/120 = (3000+6000+3000)/120 = 100
    const r = timeWeightedCadence({
      startedAt: start, endedAt: end, initial: 100,
      changes: [
        { at: new Date("2026-06-01T07:00:00Z"), cadencePerMin: 999 }, // before → ignored
        { at: new Date("2026-06-01T08:30:00Z"), cadencePerMin: 200 },
        { at: new Date("2026-06-01T09:00:00Z"), cadencePerMin: 50 },
        { at: new Date("2026-06-01T11:00:00Z"), cadencePerMin: 999 }, // after → ignored
      ],
    });
    expect(r).toBeCloseTo(100, 6);
  });

  it("returns initial for a zero-length window", () => {
    expect(timeWeightedCadence({ startedAt: start, endedAt: start, initial: 120, changes: [{ at: start, cadencePerMin: 60 }] })).toBe(120);
  });
});

describe("familleToNorme", () => {
  it("maps app families to NF E 60-182 codes", () => {
    expect(familleToNorme("Panne équipement")).toBe("AB");
    expect(familleToNorme("Intervention maintenance")).toBe("IM");
    expect(familleToNorme("Attente et transition")).toBe("AI");
    expect(familleToNorme("Utilités")).toBe("UE");
    expect(familleToNorme("Contrôle qualité")).toBe("CQ");
  });

  it("returns input if no mapping exists", () => {
    expect(familleToNorme("Unknown")).toBe("Unknown");
  });
});

describe("computeLotTrs", () => {
  it("returns null if cadence is 0 (TRS guard)", () => {
    const result = computeLotTrs({
      cadence: 0,
      cadenceUnit: "u/h",
      produced: 100,
      conforming: 100,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T13:00:00Z"),
      downtimes: [],
    });
    expect(result).toBeNull();
  });

  it("computes correct TRS for Blistereuse lot (120 blister/min)", () => {
    const result = computeLotTrs({
      cadence: 120,
      cadenceUnit: "u/min",
      produced: 34987,
      conforming: 34794,
      startedAt: new Date("2026-05-04T09:15:00Z"),
      endedAt: new Date("2026-05-04T16:55:00Z"),
      downtimes: [
        { durationMinutes: 168, isPlanned: false, famille: "Attente et transition" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.tF).toBe(292);
    expect(result!.TP).toBeCloseTo(0.998, 2);
    expect(result!.TQ).toBeCloseTo(34794 / 34987, 3);
    expect(result!.rebut).toBe(193);
    expect(result!.nonQualiteMin).toBeCloseTo(result!.tN - result!.tU, 5);
    expect(result!.downtimeByFamille).toEqual({ "Attente et transition": 168 });
    expect(result!.downtimeByNorme).toEqual({ "AI": 168 });
    expect(result!.warnings).toEqual([]);
  });

  it("computes 100% quality when all produced is conforming", () => {
    const result = computeLotTrs({
      cadence: 7200,
      cadenceUnit: "u/h",
      produced: 1000,
      conforming: 1000,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T10:00:00Z"),
      downtimes: [],
    });
    expect(result).not.toBeNull();
    expect(result!.TQ).toBe(1);
  });

  it("handles u/h cadence unit correctly", () => {
    const result = computeLotTrs({
      cadence: 7200,
      cadenceUnit: "u/h",
      produced: 7200,
      conforming: 7200,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T10:00:00Z"),
      downtimes: [],
    });
    expect(result).not.toBeNull();
    expect(result!.cadencePerMin).toBe(120);
    expect(result!.tN).toBe(60);
    expect(result!.TP).toBe(1);
  });

  it("computes Géluleuse lot at 1020 gél/min", () => {
    const result = computeLotTrs({
      cadence: 1020,
      cadenceUnit: "u/min",
      produced: 306000,
      conforming: 305000,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T14:00:00Z"),
      downtimes: [
        { durationMinutes: 20, isPlanned: false, famille: "Panne équipement" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.tF).toBe(280);
    expect(result!.cadencePerMin).toBe(1020);
    expect(result!.TQ).toBeCloseTo(305000 / 306000, 3);
    expect(result!.downtimeByNorme).toEqual({ "AB": 20 });
  });

  it("warns when conforming > produced", () => {
    const result = computeLotTrs({
      cadence: 120,
      cadenceUnit: "u/min",
      produced: 100,
      conforming: 110,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T10:00:00Z"),
      downtimes: [],
    });
    expect(result).not.toBeNull();
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0].code).toBe("CONFORMING_GT_PRODUCED");
    expect(result!.warnings[0].level).toBe("error");
  });

  it("warns when TP > 100% (cadence too low)", () => {
    const result = computeLotTrs({
      cadence: 10,
      cadenceUnit: "u/min",
      produced: 1000,
      conforming: 1000,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T10:00:00Z"),
      downtimes: [],
    });
    expect(result).not.toBeNull();
    expect(result!.TP).toBeGreaterThan(1);
    expect(result!.warnings.some(w => w.code === "TP_OVER_100")).toBe(true);
  });

  it("exposes nominalCadencePerMin equal to cadencePerMin when no changes", () => {
    const result = computeLotTrs({
      cadence: 7200,
      cadenceUnit: "u/h",
      produced: 7200,
      conforming: 7200,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T10:00:00Z"),
      downtimes: [],
    });
    expect(result!.nominalCadencePerMin).toBe(120);
    expect(result!.cadencePerMin).toBe(120);
    expect(result!.warnings).toEqual([]);
  });

  it("time-weights cadence when cadenceChanges provided", () => {
    // Lot 09:00-11:00 (120 min). Consigne 120 u/min → réduite à 60 u/min à 10:00.
    // 60 min @120 + 60 min @60 → pondérée = 90 u/min.
    // Produced = 90*120 = 10800 (exact pace at weighted cadence).
    const result = computeLotTrs({
      cadence: 120,           // initial consigne
      cadenceUnit: "u/min",
      produced: 10800,
      conforming: 10800,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T11:00:00Z"),
      downtimes: [],
      cadenceChanges: [{ at: new Date("2026-05-04T10:00:00Z"), cadencePerMin: 60 }],
    });
    expect(result).not.toBeNull();
    expect(result!.nominalCadencePerMin).toBe(120);          // initial consigne
    expect(result!.cadencePerMin).toBeCloseTo(90, 5);        // time-weighted effective
    expect(result!.tN).toBeCloseTo(10800 / 90, 3);          // 120 min
    expect(result!.TP).toBeCloseTo(1, 3);                    // produced exactly at weighted pace
    // Cadence dropped 25% → CADENCE_WEIGHTED warning emitted
    expect(result!.warnings.some(w => w.code === "CADENCE_WEIGHTED")).toBe(true);
  });

  it("no CADENCE_WEIGHTED warning when change is within 5%", () => {
    // 60 min @100 + 60 min @98 → weighted = 99, deviation = 1% < 5%
    const result = computeLotTrs({
      cadence: 100,
      cadenceUnit: "u/min",
      produced: 5940,
      conforming: 5940,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T11:00:00Z"),
      downtimes: [],
      cadenceChanges: [{ at: new Date("2026-05-04T10:00:00Z"), cadencePerMin: 98 }],
    });
    expect(result!.warnings.filter(w => w.code === "CADENCE_WEIGHTED")).toHaveLength(0);
  });

  it("subtracts planned + unplanned downtimes from tF (NF E 60-182 §2.2.6)", () => {
    // Lot: 120min, 10min planned (changement format), 20min unplanned (panne)
    // tF = 120 - 10 - 20 = 90 (NOT 100)
    const result = computeLotTrs({
      cadence: 100,
      cadenceUnit: "u/min",
      produced: 8000,
      conforming: 7900,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T11:00:00Z"),
      downtimes: [
        { durationMinutes: 10, isPlanned: true, famille: "Nettoyage" },
        { durationMinutes: 20, isPlanned: false, famille: "Panne équipement" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.plannedMin).toBe(10);
    expect(result!.unplannedMin).toBe(20);
    expect(result!.tF).toBe(90); // 120 - 10 - 20
    expect(result!.TP).toBeCloseTo(8000 / 100 / 90, 3); // tN/tF
  });

  it("does NOT cap TP at 1 anymore", () => {
    const result = computeLotTrs({
      cadence: 10,
      cadenceUnit: "u/min",
      produced: 1000,
      conforming: 1000,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T10:00:00Z"),
      downtimes: [],
    });
    expect(result).not.toBeNull();
    // tN = 1000/10 = 100min, tF = 60min → TP = 100/60 = 1.667
    expect(result!.TP).toBeCloseTo(100 / 60, 3);
  });
});

describe("computeSessionTrs", () => {
  it("computes tF at session level per NF E 60-182 (tR - totalUnplanned)", () => {
    // Session: 08:00 → 17:00 = 540min, planned=120min → tR=420min
    // Lot 1: 225min, 15min unplanned → lot tF=210 (old)
    // Lot 2: 195min, 0min unplanned → lot tF=195 (old)
    // Old sum-of-lots: tF=405. New NF E 60-182: tF = tR - 15 = 405 (same here because lot durations happen to add up to tR)
    const lot1 = {
      lotDurationMin: 225, plannedMin: 0, unplannedMin: 15, tF: 210, tN: 200, tU: 198,
      nonQualiteMin: 2, TP: 200 / 210, TQ: 0.99, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 10,
      rebut: 240, downtimeByFamille: { "Panne équipement": 15 }, downtimeByNorme: { "AB": 15 },
      produced: 24000, conforming: 23760, warnings: [],
    };
    const lot2 = {
      lotDurationMin: 195, plannedMin: 0, unplannedMin: 0, tF: 195, tN: 190, tU: 188,
      nonQualiteMin: 2, TP: 190 / 195, TQ: 0.99, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 5,
      rebut: 240, downtimeByFamille: {}, downtimeByNorme: {},
      produced: 22800, conforming: 22560, warnings: [],
    };
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T17:00:00Z"),
      plannedStopsMin: 120,
      lots: [lot1, lot2],
    });

    expect(result.tT).toBe(1440);
    expect(result.tO).toBe(540);
    expect(result.fermeture).toBe(900);
    expect(result.tR).toBe(420);
    // NF E 60-182: tF = tR - totalUnplanned = 420 - 15 = 405
    expect(result.tF).toBe(405);
    expect(result.lotCount).toBe(2);
    expect(result.totalProduced).toBe(46800);
    expect(result.totalConforming).toBe(46320);
    expect(result.totalRebut).toBe(480);
    expect(result.DO).toBeCloseTo(405 / 420, 3);
    expect(result.TRS).toBeGreaterThan(0);
    expect(result.TRS).toBeLessThanOrEqual(1);
    expect(result.downtimeByFamille).toEqual({ "Panne équipement": 15 });
    expect(result.downtimeByNorme).toEqual({ "AB": 15 });
    expect(result.totalUnplannedMin).toBe(15);
    // Audit trail
    expect(result.audit.tF_norme).toBe(405);
    expect(result.audit.tF_lots).toBe(405);
    expect(result.audit.tF_delta).toBe(0);
  });

  it("subtracts session-level unplanned stops (inter-lot, no active lot) from tF", () => {
    // Session 08:00→17:00 = 540min, planned (changeover/cleaning) = 120 → tR = 420.
    // One lot with 15min unplanned during it + 30min unplanned recorded BETWEEN lots
    // (session-level, no lot). tF = tR - (15 + 30) = 375.
    const lot1 = {
      lotDurationMin: 225, plannedMin: 0, unplannedMin: 15, tF: 210, tN: 200, tU: 198,
      nonQualiteMin: 2, TP: 200 / 210, TQ: 0.99, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 10,
      rebut: 240, downtimeByFamille: { "Panne équipement": 15 }, downtimeByNorme: { "AB": 15 },
      produced: 24000, conforming: 23760, warnings: [],
    };
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T17:00:00Z"),
      plannedStopsMin: 120,
      unplannedStopsMin: 30,
      lots: [lot1],
    });
    expect(result.tR).toBe(420);
    expect(result.tF).toBe(375);           // 420 - 15 - 30
    expect(result.totalUnplannedMin).toBe(45);
    expect(result.DO).toBeCloseTo(375 / 420, 3);
  });

  it("is unchanged when unplannedStopsMin is omitted (backward compatible)", () => {
    const lot1 = {
      lotDurationMin: 225, plannedMin: 0, unplannedMin: 15, tF: 210, tN: 200, tU: 198,
      nonQualiteMin: 2, TP: 200 / 210, TQ: 0.99, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 10,
      rebut: 240, downtimeByFamille: { "Panne équipement": 15 }, downtimeByNorme: { "AB": 15 },
      produced: 24000, conforming: 23760, warnings: [],
    };
    const base = { openedAt: new Date("2026-05-04T08:00:00Z"), closedAt: new Date("2026-05-04T17:00:00Z"), plannedStopsMin: 120, lots: [lot1] };
    const a = computeSessionTrs(base);
    const b = computeSessionTrs({ ...base, unplannedStopsMin: 0 });
    expect(a.tF).toBe(b.tF);
    expect(a.totalUnplannedMin).toBe(b.totalUnplannedMin);
  });

  it("subtracts planned lot downtimes from tF (NF E 60-182)", () => {
    // Session: 08:00 → 16:00 = 480min, session events=60min → tR=420min
    // Lot 1: 200min, 10min planned downtime, 15min unplanned → lot tF=175
    // tF_norme = tR - (10+15) = 395
    const lot1 = {
      lotDurationMin: 200, plannedMin: 10, unplannedMin: 15, tF: 175, tN: 170, tU: 168,
      nonQualiteMin: 2, TP: 170 / 175, TQ: 0.988, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 5,
      rebut: 240, downtimeByFamille: { "Nettoyage": 10, "Panne équipement": 15 }, downtimeByNorme: { "AP": 10, "AB": 15 },
      produced: 20400, conforming: 20160, warnings: [],
    };
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T16:00:00Z"),
      plannedStopsMin: 60,
      lots: [lot1],
    });
    // tF = tR(420) - planned lot(10) - unplanned(15) = 395
    expect(result.tF).toBe(395);
    expect(result.DO).toBeCloseTo(395 / 420, 3);
    expect(result.TRS).toBeCloseTo(168 / 420, 3); // tU/tR unchanged
    // DO × TP × TQ = TRS
    expect(result.DO * result.TP * result.TQ).toBeCloseTo(result.TRS, 3);
  });

  it("correctly handles inter-lot gap (tF_norme > tF_lots)", () => {
    // Session: 08:00 → 16:00 = 480min, planned=60min → tR=420min
    // But lots only cover 300min total → 120min gap (CHSB, montage, etc.)
    // Unplanned: 20min total
    const lot1 = {
      lotDurationMin: 180, plannedMin: 0, unplannedMin: 20, tF: 160, tN: 150, tU: 148,
      nonQualiteMin: 2, TP: 150 / 160, TQ: 148 / 150, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 10,
      rebut: 240, downtimeByFamille: { "Panne équipement": 20 }, downtimeByNorme: { "AB": 20 },
      produced: 18000, conforming: 17760, warnings: [],
    };
    const lot2 = {
      lotDurationMin: 120, plannedMin: 0, unplannedMin: 0, tF: 120, tN: 110, tU: 109,
      nonQualiteMin: 1, TP: 110 / 120, TQ: 109 / 110, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 10,
      rebut: 120, downtimeByFamille: {}, downtimeByNorme: {},
      produced: 13200, conforming: 13080, warnings: [],
    };
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T16:00:00Z"),
      plannedStopsMin: 60,
      lots: [lot1, lot2],
    });

    // NF E 60-182: tF = tR - totalUnplanned = 420 - 20 = 400
    expect(result.tF).toBe(400);
    // Old lot-sum: tF = 160 + 120 = 280
    expect(result.audit.tF_lots).toBe(280);
    expect(result.audit.tF_delta).toBe(120); // 120min gap captured!
    // Should have a reconciliation warning because delta > 5
    expect(result.warnings.some(w => w.code === "TF_RECONCILIATION")).toBe(true);
  });

  it("handles empty session (no lots)", () => {
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-15T08:00:00Z"),
      closedAt: new Date("2026-05-15T17:00:00Z"),
      plannedStopsMin: 540,
      lots: [],
    });
    expect(result.tO).toBe(540);
    expect(result.tR).toBe(0);
    expect(result.TRS).toBe(0);
    expect(result.lotCount).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.audit.tF_norme).toBe(0);
  });

  it("warns when tAP > tO", () => {
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T12:00:00Z"),
      plannedStopsMin: 300,
      lots: [],
    });
    expect(result.warnings.some(w => w.code === "TAP_GT_TO")).toBe(true);
  });

  it("DO = 1 when no unplanned stops (tF = tR)", () => {
    // No lots, no unplanned stops → tF = tR → DO = 1
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T12:00:00Z"),
      plannedStopsMin: 0,
      lots: [],
    });
    expect(result.DO).toBe(1); // tF = tR = 240, no unplanned → DO=100%
    expect(result.TRS).toBe(0); // but TRS=0 because tU=0
  });

  it("propagates lot-level warnings to session", () => {
    const lot = {
      lotDurationMin: 60, plannedMin: 0, unplannedMin: 0, tF: 60, tN: 50, tU: 48,
      nonQualiteMin: 2, TP: 50 / 60, TQ: 48 / 50, cadencePerMin: 120, nominalCadencePerMin: 120, ecartCadence: 10,
      rebut: 240, downtimeByFamille: {}, downtimeByNorme: {},
      produced: 6000, conforming: 5760,
      warnings: [{ code: "CONFORMING_GT_PRODUCED", level: "error" as const, message: "test", field: "TQ" }],
    };
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T12:00:00Z"),
      plannedStopsMin: 0,
      lots: [lot],
    });
    expect(result.warnings.some(w => w.code === "CONFORMING_GT_PRODUCED")).toBe(true);
  });
});

describe("computeZoomTrs", () => {
  it("aggregates multiple sessions (monthly zoom)", () => {
    const emptyAudit = { tF_norme: 405, tF_lots: 405, tF_delta: 0, formula: "" };
    const session1 = {
      tT: 1440, tO: 540, fermeture: 900, tAP: 120, tR: 420, tF: 405, tN: 390, tU: 386,
      nonQualiteMin: 4, ecartCadenceMin: 15, totalUnplannedMin: 15,
      DO: 405 / 420, TP: 390 / 405, TQ: 0.99,
      TRS: 386 / 420, TRG: 386 / 540,
      lotCount: 2, totalProduced: 46800, totalConforming: 46320, totalRebut: 480,
      downtimeByFamille: { "Panne équipement": 15 }, downtimeByNorme: { "AB": 15 },
      warnings: [], audit: emptyAudit,
    };
    const emptyAudit2 = { tF_norme: 370, tF_lots: 370, tF_delta: 0, formula: "" };
    const session2 = {
      tT: 1440, tO: 480, fermeture: 960, tAP: 90, tR: 390, tF: 370, tN: 360, tU: 355,
      nonQualiteMin: 5, ecartCadenceMin: 10, totalUnplannedMin: 20,
      DO: 370 / 390, TP: 360 / 370, TQ: 0.985,
      TRS: 355 / 390, TRG: 355 / 480,
      lotCount: 1, totalProduced: 43200, totalConforming: 42552, totalRebut: 648,
      downtimeByFamille: { "Attente et transition": 20 }, downtimeByNorme: { "AI": 20 },
      warnings: [], audit: emptyAudit2,
    };

    const result = computeZoomTrs({ sessions: [session1, session2] });

    expect(result.tT).toBe(2880);
    expect(result.tO).toBe(1020);
    expect(result.fermeture).toBe(1860);
    expect(result.tR).toBe(810);
    expect(result.lotCount).toBe(3);
    expect(result.totalProduced).toBe(90000);
    expect(result.totalRebut).toBe(1128);
    expect(result.TRS).toBeGreaterThan(0);
    expect(result.TRS).toBeLessThanOrEqual(1);
    expect(result.downtimeByFamille).toEqual({ "Panne équipement": 15, "Attente et transition": 20 });
    expect(result.downtimeByNorme).toEqual({ "AB": 15, "AI": 20 });
    expect(result.audit.tF_norme).toBe(775);
    expect(result.audit.tF_lots).toBe(775);
  });

  it("returns zeros for empty zoom", () => {
    const result = computeZoomTrs({ sessions: [] });
    expect(result.TRS).toBe(0);
    expect(result.tO).toBe(0);
    expect(result.tT).toBe(0);
    expect(result.downtimeByFamille).toEqual({});
    expect(result.downtimeByNorme).toEqual({});
    expect(result.warnings).toEqual([]);
  });
});

// ─── Excel regression tests ────────────────────────────────
// These reproduce exact rows from the Blistereuse/Géluleuse Excel files

describe("Excel regression — Blistereuse Mai 2026", () => {
  it("Row 7: Aeronide 200µg, lot 26013 — TRS=66.7%", () => {
    // Excel values: tO=540, tAP=105 (Pause=60, CHSB=0, APR=45), tR=435
    // AB=53, AI=90, UE=0, IM=0 → tAI=143 → tF=292
    // NPR=34987, NPB=34794, NPC=193, cadence=120 blister/min
    const lot = computeLotTrs({
      cadence: 120,
      cadenceUnit: "u/min",
      produced: 34987,
      conforming: 34794,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T16:55:00Z"), // ~460min lot
      downtimes: [
        { durationMinutes: 53, isPlanned: false, famille: "Panne équipement" },
        { durationMinutes: 90, isPlanned: false, famille: "Attente et transition" },
      ],
    });
    expect(lot).not.toBeNull();

    const session = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T17:00:00Z"), // tO=540
      plannedStopsMin: 105,
      lots: [{ ...lot!, produced: 34987, conforming: 34794 }],
    });

    // NF E 60-182: tF = tR - totalUnplanned = 435 - 143 = 292
    expect(session.tF).toBe(292);
    expect(session.tR).toBe(435);
    expect(session.tO).toBe(540);

    // Verify against Excel values
    const tN = 34987 / 120; // = 291.558
    const tU = 34794 / 120; // = 289.95
    expect(session.tN).toBeCloseTo(tN, 1);
    expect(session.tU).toBeCloseTo(tU, 1);

    expect(session.DO).toBeCloseTo(292 / 435, 3);   // 67.1%
    expect(session.TP).toBeCloseTo(tN / 292, 3);    // 99.8%
    expect(session.TQ).toBeCloseTo(tU / tN, 3);     // 99.4%
    expect(session.TRS).toBeCloseTo(tU / 435, 3);   // 66.7%
    expect(session.TRG).toBeCloseTo(tU / 540, 3);   // 53.7%

    // Cross-check: DO × TP × TQ ≈ TRS
    expect(session.DO * session.TP * session.TQ).toBeCloseTo(session.TRS, 3);

    // Norme codes
    expect(session.downtimeByNorme["AB"]).toBe(53);
    expect(session.downtimeByNorme["AI"]).toBe(90);

    // No errors expected
    expect(session.warnings.filter(w => w.level === "error")).toHaveLength(0);
  });

  it("Row 8: Aeronide 400µg, lot 26015 — TRS=74.7%", () => {
    // Excel: tO=540, tAP=150 (Pause=60, CHSB=0, APR=90), tR=390
    // AB=82, AI=0, UE=0, IM=0 → tAI=82 → tF=308
    // NPR=35132, NPB=34962, NPC=170, cadence=120
    const lot = computeLotTrs({
      cadence: 120,
      cadenceUnit: "u/min",
      produced: 35132,
      conforming: 34962,
      startedAt: new Date("2026-05-05T09:00:00Z"),
      endedAt: new Date("2026-05-05T16:00:00Z"),
      downtimes: [
        { durationMinutes: 82, isPlanned: false, famille: "Panne équipement" },
      ],
    });
    expect(lot).not.toBeNull();

    const session = computeSessionTrs({
      openedAt: new Date("2026-05-05T08:00:00Z"),
      closedAt: new Date("2026-05-05T17:00:00Z"),
      plannedStopsMin: 150,
      lots: [{ ...lot!, produced: 35132, conforming: 34962 }],
    });

    expect(session.tF).toBe(308);
    expect(session.tR).toBe(390);

    const tN = 35132 / 120;
    const tU = 34962 / 120;
    expect(session.DO).toBeCloseTo(308 / 390, 3);
    expect(session.TP).toBeCloseTo(tN / 308, 3);
    expect(session.TQ).toBeCloseTo(34962 / 35132, 3);
    expect(session.TRS).toBeCloseTo(tU / 390, 3);

    expect(session.DO * session.TP * session.TQ).toBeCloseTo(session.TRS, 3);
  });
});

// ─── V: Weighted aggregation verification ───────────────────

describe("computeZoomTrs — weighted aggregation (V)", () => {
  it("uses time-weighted aggregation, NOT simple average", () => {
    const auditA = { tF_norme: 405, tF_lots: 405, tF_delta: 0, formula: "" };
    const sessionA = {
      tT: 1440, tO: 540, fermeture: 900, tAP: 120, tR: 420, tF: 405, tN: 390, tU: 386,
      nonQualiteMin: 4, ecartCadenceMin: 15, totalUnplannedMin: 15,
      DO: 405 / 420, TP: 390 / 405, TQ: 386 / 390,
      TRS: 386 / 420, TRG: 386 / 540,
      lotCount: 2, totalProduced: 46800, totalConforming: 46320, totalRebut: 480,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [], audit: auditA,
    };
    const auditB = { tF_norme: 15, tF_lots: 15, tF_delta: 0, formula: "" };
    const sessionB = {
      tT: 1440, tO: 40, fermeture: 1400, tAP: 10, tR: 30, tF: 15, tN: 10, tU: 9,
      nonQualiteMin: 1, ecartCadenceMin: 5, totalUnplannedMin: 15,
      DO: 15 / 30, TP: 10 / 15, TQ: 9 / 10,
      TRS: 9 / 30, TRG: 9 / 40,
      lotCount: 1, totalProduced: 1200, totalConforming: 1080, totalRebut: 120,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [], audit: auditB,
    };

    const result = computeZoomTrs({ sessions: [sessionA, sessionB] });

    // Weighted DO = (405+15) / (420+30) = 420/450 = 93.3%
    expect(result.DO).toBeCloseTo(420 / 450, 3);
    // Simple average would be (405/420 + 15/30) / 2 = 0.732
    expect(result.DO).not.toBeCloseTo(0.732, 2);

    // TRS = tU/tR = (386+9)/(420+30) = 395/450
    expect(result.TRS).toBeCloseTo(395 / 450, 3);

    // DO × TP × TQ = TRS
    expect(result.DO * result.TP * result.TQ).toBeCloseTo(result.TRS, 3);
  });
});

// ─── W: Product-level aggregation ───────────────────────────

describe("computeProductTrs (W)", () => {
  it("aggregates lots by product with time-weighted metrics", () => {
    const lots = [
      { productId: "p1", productName: "Aerofor 12µg", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 34000, conforming: 33800, lotDurationMin: 300, unplannedMin: 20, tF: 280, tN: 283.33, tU: 281.67 },
      { productId: "p1", productName: "Aerofor 12µg", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 28000, conforming: 27800, lotDurationMin: 250, unplannedMin: 10, tF: 240, tN: 233.33, tU: 231.67 },
      { productId: "p2", productName: "Combifor 12/400µg", cadence: 100, cadenceUnit: "u/min" as const,
        produced: 15000, conforming: 14900, lotDurationMin: 180, unplannedMin: 15, tF: 165, tN: 150, tU: 149 },
    ];

    const results = computeProductTrs(lots);
    expect(results).toHaveLength(2);

    const aerofor = results.find(r => r.productId === "p1")!;
    const combifor = results.find(r => r.productId === "p2")!;

    expect(aerofor.lotCount).toBe(2);
    expect(aerofor.totalProduced).toBe(62000);
    expect(aerofor.totalConforming).toBe(61600);
    expect(aerofor.totalRebut).toBe(400);
    expect(aerofor.totalDurationMin).toBe(550);
    expect(aerofor.DO).toBeCloseTo(520 / 550, 3);
    expect(aerofor.TQ).toBeCloseTo(61600 / 62000, 3);

    expect(combifor.lotCount).toBe(1);
    expect(combifor.totalProduced).toBe(15000);
    expect(combifor.DO).toBeCloseTo(165 / 180, 3);
  });

  it("returns empty array for no lots", () => {
    expect(computeProductTrs([])).toEqual([]);
  });

  it("computes weighted average cadence", () => {
    const lots = [
      { productId: "p1", productName: "X", cadence: 100, cadenceUnit: "u/min" as const,
        produced: 10000, conforming: 10000, lotDurationMin: 100, unplannedMin: 0, tF: 100, tN: 100, tU: 100 },
      { productId: "p1", productName: "X", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 24000, conforming: 24000, lotDurationMin: 200, unplannedMin: 0, tF: 200, tN: 200, tU: 200 },
    ];
    const results = computeProductTrs(lots);
    expect(results[0].avgCadencePerMin).toBeCloseTo(113.33, 1);
  });
});

// ─── X: Six Big Losses ──────────────────────────────────────

describe("computeSixBigLosses (X)", () => {
  it("classifies losses into 6 Nakajima categories", () => {
    const sessionTrs = {
      tT: 1440, tO: 540, fermeture: 900, tAP: 60, tR: 480, tF: 405,
      tN: 390, tU: 386, nonQualiteMin: 4, ecartCadenceMin: 15, totalUnplannedMin: 75,
      DO: 405 / 480, TP: 390 / 405, TQ: 386 / 390,
      TRS: 386 / 480, TRG: 386 / 540,
      lotCount: 2, totalProduced: 46800, totalConforming: 46320, totalRebut: 480,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
      audit: { tF_norme: 405, tF_lots: 405, tF_delta: 0, formula: "" },
    };

    const downtimeDetails = [
      { durationMinutes: 45, famille: "Panne équipement", isPlanned: false },
      { durationMinutes: 30, famille: "CHSB", isPlanned: true },
      { durationMinutes: 3, famille: "Micro-arrêt", isPlanned: false },
      { durationMinutes: 2, famille: "Micro-arrêt", isPlanned: false },
    ];

    const result = computeSixBigLosses(sessionTrs, downtimeDetails, 5);
    expect(result.losses).toHaveLength(6);

    const breakdown = result.losses.find(l => l.category === "breakdown")!;
    expect(breakdown.minutes).toBe(45);
    expect(breakdown.oeeComponent).toBe("availability");

    const setup = result.losses.find(l => l.category === "setup")!;
    expect(setup.minutes).toBe(30 + 60); // planned DT + tAP
    expect(setup.oeeComponent).toBe("availability");

    const microStop = result.losses.find(l => l.category === "micro_stop")!;
    expect(microStop.minutes).toBe(5);
    expect(microStop.oeeComponent).toBe("performance");

    const speedLoss = result.losses.find(l => l.category === "speed_loss")!;
    expect(speedLoss.minutes).toBe(15);
    expect(speedLoss.oeeComponent).toBe("performance");
  });

  it("returns zeros when no losses", () => {
    const sessionTrs = {
      tT: 1440, tO: 1440, fermeture: 0, tAP: 0, tR: 1440, tF: 1440,
      tN: 1440, tU: 1440, nonQualiteMin: 0, ecartCadenceMin: 0, totalUnplannedMin: 0,
      DO: 1, TP: 1, TQ: 1, TRS: 1, TRG: 1,
      lotCount: 1, totalProduced: 100, totalConforming: 100, totalRebut: 0,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
      audit: { tF_norme: 1440, tF_lots: 1440, tF_delta: 0, formula: "" },
    };

    const result = computeSixBigLosses(sessionTrs, []);
    expect(result.losses.every(l => l.minutes === 0)).toBe(true);
  });
});

describe("Excel regression — Géluleuse Mai 2026", () => {
  it("Row 7: Aeronide 400µg, lot 26016, cadence 1020 gél/min", () => {
    // Excel: tO=540, tAP=90 (Pause=0, CHSG=0, APR=90, MQCH=0), tR=450
    // AG=22, AI=0, UE=0, IM=0 → tAI=22 → tF=428
    // NPR=354624, NPB=353218, NPC=1406, cadence=1020
    const lot = computeLotTrs({
      cadence: 1020,
      cadenceUnit: "u/min",
      produced: 354624,
      conforming: 353218,
      startedAt: new Date("2026-05-04T08:30:00Z"),
      endedAt: new Date("2026-05-04T16:30:00Z"),
      downtimes: [
        { durationMinutes: 22, isPlanned: false, famille: "Panne équipement" },
      ],
    });
    expect(lot).not.toBeNull();

    const session = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T17:00:00Z"),
      plannedStopsMin: 90,
      lots: [{ ...lot!, produced: 354624, conforming: 353218 }],
    });

    expect(session.tF).toBe(428);
    expect(session.tR).toBe(450);

    const tN = 354624 / 1020;
    const tU = 353218 / 1020;
    expect(session.DO).toBeCloseTo(428 / 450, 3);
    expect(session.TP).toBeCloseTo(tN / 428, 3);
    expect(session.TRS).toBeCloseTo(tU / 450, 3);
    expect(session.DO * session.TP * session.TQ).toBeCloseTo(session.TRS, 3);
  });
});

// ─── V: Weighted aggregation verification ───────────────────

describe("computeZoomTrs — weighted aggregation (V)", () => {
  it("uses time-weighted aggregation, NOT simple average", () => {
    const auditA = { tF_norme: 405, tF_lots: 405, tF_delta: 0, formula: "" };
    const sessionA = {
      tT: 1440, tO: 540, fermeture: 900, tAP: 120, tR: 420, tF: 405, tN: 390, tU: 386,
      nonQualiteMin: 4, ecartCadenceMin: 15, totalUnplannedMin: 15,
      DO: 405 / 420, TP: 390 / 405, TQ: 386 / 390,
      TRS: 386 / 420, TRG: 386 / 540,
      lotCount: 2, totalProduced: 46800, totalConforming: 46320, totalRebut: 480,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [], audit: auditA,
    };
    const auditB = { tF_norme: 15, tF_lots: 15, tF_delta: 0, formula: "" };
    const sessionB = {
      tT: 1440, tO: 40, fermeture: 1400, tAP: 10, tR: 30, tF: 15, tN: 10, tU: 9,
      nonQualiteMin: 1, ecartCadenceMin: 5, totalUnplannedMin: 15,
      DO: 15 / 30, TP: 10 / 15, TQ: 9 / 10,
      TRS: 9 / 30, TRG: 9 / 40,
      lotCount: 1, totalProduced: 1200, totalConforming: 1080, totalRebut: 120,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [], audit: auditB,
    };

    const result = computeZoomTrs({ sessions: [sessionA, sessionB] });

    // Weighted DO = (405+15) / (420+30) = 420/450 = 93.3%
    expect(result.DO).toBeCloseTo(420 / 450, 3);
    // Simple average would be (405/420 + 15/30) / 2 = 0.732
    expect(result.DO).not.toBeCloseTo(0.732, 2);

    // TRS = tU/tR = (386+9)/(420+30) = 395/450
    expect(result.TRS).toBeCloseTo(395 / 450, 3);

    // DO × TP × TQ = TRS
    expect(result.DO * result.TP * result.TQ).toBeCloseTo(result.TRS, 3);
  });
});

// ─── W: Product-level aggregation ───────────────────────────

describe("computeProductTrs (W)", () => {
  it("aggregates lots by product with time-weighted metrics", () => {
    const lots = [
      { productId: "p1", productName: "Aerofor 12µg", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 34000, conforming: 33800, lotDurationMin: 300, unplannedMin: 20, tF: 280, tN: 283.33, tU: 281.67 },
      { productId: "p1", productName: "Aerofor 12µg", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 28000, conforming: 27800, lotDurationMin: 250, unplannedMin: 10, tF: 240, tN: 233.33, tU: 231.67 },
      { productId: "p2", productName: "Combifor 12/400µg", cadence: 100, cadenceUnit: "u/min" as const,
        produced: 15000, conforming: 14900, lotDurationMin: 180, unplannedMin: 15, tF: 165, tN: 150, tU: 149 },
    ];

    const results = computeProductTrs(lots);
    expect(results).toHaveLength(2);

    const aerofor = results.find(r => r.productId === "p1")!;
    const combifor = results.find(r => r.productId === "p2")!;

    expect(aerofor.lotCount).toBe(2);
    expect(aerofor.totalProduced).toBe(62000);
    expect(aerofor.totalConforming).toBe(61600);
    expect(aerofor.totalRebut).toBe(400);
    expect(aerofor.totalDurationMin).toBe(550);
    expect(aerofor.DO).toBeCloseTo(520 / 550, 3);
    expect(aerofor.TQ).toBeCloseTo(61600 / 62000, 3);

    expect(combifor.lotCount).toBe(1);
    expect(combifor.totalProduced).toBe(15000);
    expect(combifor.DO).toBeCloseTo(165 / 180, 3);
  });

  it("returns empty array for no lots", () => {
    expect(computeProductTrs([])).toEqual([]);
  });

  it("computes weighted average cadence", () => {
    const lots = [
      { productId: "p1", productName: "X", cadence: 100, cadenceUnit: "u/min" as const,
        produced: 10000, conforming: 10000, lotDurationMin: 100, unplannedMin: 0, tF: 100, tN: 100, tU: 100 },
      { productId: "p1", productName: "X", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 24000, conforming: 24000, lotDurationMin: 200, unplannedMin: 0, tF: 200, tN: 200, tU: 200 },
    ];
    const results = computeProductTrs(lots);
    expect(results[0].avgCadencePerMin).toBeCloseTo(113.33, 1);
  });
});

// ─── X: Six Big Losses ──────────────────────────────────────

describe("computeSixBigLosses (X)", () => {
  it("classifies losses into 6 Nakajima categories", () => {
    const sessionTrs = {
      tT: 1440, tO: 540, fermeture: 900, tAP: 60, tR: 480, tF: 405,
      tN: 390, tU: 386, nonQualiteMin: 4, ecartCadenceMin: 15, totalUnplannedMin: 75,
      DO: 405 / 480, TP: 390 / 405, TQ: 386 / 390,
      TRS: 386 / 480, TRG: 386 / 540,
      lotCount: 2, totalProduced: 46800, totalConforming: 46320, totalRebut: 480,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
      audit: { tF_norme: 405, tF_lots: 405, tF_delta: 0, formula: "" },
    };

    const downtimeDetails = [
      { durationMinutes: 45, famille: "Panne équipement", isPlanned: false },
      { durationMinutes: 30, famille: "CHSB", isPlanned: true },
      { durationMinutes: 3, famille: "Micro-arrêt", isPlanned: false },
      { durationMinutes: 2, famille: "Micro-arrêt", isPlanned: false },
    ];

    const result = computeSixBigLosses(sessionTrs, downtimeDetails, 5);
    expect(result.losses).toHaveLength(6);

    const breakdown = result.losses.find(l => l.category === "breakdown")!;
    expect(breakdown.minutes).toBe(45);
    expect(breakdown.oeeComponent).toBe("availability");

    const setup = result.losses.find(l => l.category === "setup")!;
    expect(setup.minutes).toBe(30 + 60); // planned DT + tAP
    expect(setup.oeeComponent).toBe("availability");

    const microStop = result.losses.find(l => l.category === "micro_stop")!;
    expect(microStop.minutes).toBe(5);
    expect(microStop.oeeComponent).toBe("performance");

    const speedLoss = result.losses.find(l => l.category === "speed_loss")!;
    expect(speedLoss.minutes).toBe(15);
    expect(speedLoss.oeeComponent).toBe("performance");
  });

  it("returns zeros when no losses", () => {
    const sessionTrs = {
      tT: 1440, tO: 1440, fermeture: 0, tAP: 0, tR: 1440, tF: 1440,
      tN: 1440, tU: 1440, nonQualiteMin: 0, ecartCadenceMin: 0, totalUnplannedMin: 0,
      DO: 1, TP: 1, TQ: 1, TRS: 1, TRG: 1,
      lotCount: 1, totalProduced: 100, totalConforming: 100, totalRebut: 0,
      downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
      audit: { tF_norme: 1440, tF_lots: 1440, tF_delta: 0, formula: "" },
    };

    const result = computeSixBigLosses(sessionTrs, []);
    expect(result.losses.every(l => l.minutes === 0)).toBe(true);
  });
});

// ─── Period grouping (day / week / month) ───────────────────

describe("isoWeekKey / periodKey", () => {
  it("computes ISO week keys (Monday-based)", () => {
    expect(isoWeekKey("2026-05-28")).toBe("2026-W22"); // Thursday
    expect(isoWeekKey("2026-05-25")).toBe("2026-W22"); // Monday same week
    expect(isoWeekKey("2026-05-31")).toBe("2026-W22"); // Sunday same week
    expect(isoWeekKey("2026-06-01")).toBe("2026-W23"); // next Monday
  });

  it("derives day / week / month keys", () => {
    expect(periodKey("2026-05-28", "day")).toBe("2026-05-28");
    expect(periodKey("2026-05-28", "month")).toBe("2026-05");
    expect(periodKey("2026-05-28", "week")).toBe("2026-W22");
  });
});

describe("groupSessionsByPeriod", () => {
  const mk = (date: string, tR: number, tU: number) => ({
    date,
    tT: 1440, tO: tR, fermeture: 0, tAP: 0, tR, tF: tR, tN: tU, tU,
    nonQualiteMin: 0, ecartCadenceMin: 0, totalUnplannedMin: 0,
    DO: 1, TP: tR > 0 ? tU / tR : 0, TQ: 1, TRS: tR > 0 ? tU / tR : 0, TRG: 0,
    lotCount: 1, totalProduced: tU, totalConforming: tU, totalRebut: 0,
    downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
    audit: { tF_norme: tR, tF_lots: tR, tF_delta: 0, formula: "" },
  });

  const sessions = [
    mk("2026-05-25", 400, 300), // W22
    mk("2026-05-26", 400, 360), // W22
    mk("2026-06-01", 400, 200), // W23 / June
  ];

  it("buckets by week and re-aggregates as Σtu/Σtr", () => {
    const weeks = groupSessionsByPeriod(sessions, "week");
    expect(weeks).toHaveLength(2);
    const w22 = weeks.find(w => w.periodKey === "2026-W22")!;
    expect(w22.tR).toBe(800);
    expect(w22.tU).toBe(660);
    expect(w22.TRS).toBeCloseTo(660 / 800, 6);
  });

  it("month total equals the sum of its days (day -> month reconciles)", () => {
    const mayOnly = sessions.filter(s => s.date.startsWith("2026-05"));
    const may = groupSessionsByPeriod(mayOnly, "month");
    const days = groupSessionsByPeriod(mayOnly, "day");
    const sumDayTU = days.reduce((s, d) => s + d.tU, 0);
    const sumDayTR = days.reduce((s, d) => s + d.tR, 0);
    expect(may).toHaveLength(1);
    expect(may[0].tU).toBe(sumDayTU);
    expect(may[0].tR).toBe(sumDayTR);
    expect(may[0].TRS).toBeCloseTo(sumDayTU / sumDayTR, 6);
  });

  it("grouped buckets reconcile with the global zoom", () => {
    const zoom = computeZoomTrs({ sessions });
    const weeks = groupSessionsByPeriod(sessions, "week");
    const sumTU = weeks.reduce((s, w) => s + w.tU, 0);
    const sumTR = weeks.reduce((s, w) => s + w.tR, 0);
    expect(sumTU).toBe(zoom.tU);
    expect(sumTR).toBe(zoom.tR);
    expect(sumTU / sumTR).toBeCloseTo(zoom.TRS, 6);
  });
});

describe("computeProductTrs reconciliation", () => {
  it("Sum allocated tR equals periodTR and reconciles with global TRS", () => {
    const lots = [
      { productId: "p1", productName: "A", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 34000, conforming: 33800, lotDurationMin: 300, unplannedMin: 20, tF: 280, tN: 283.33, tU: 281.67 },
      { productId: "p2", productName: "B", cadence: 100, cadenceUnit: "u/min" as const,
        produced: 15000, conforming: 14900, lotDurationMin: 180, unplannedMin: 15, tF: 165, tN: 150, tU: 149 },
    ];
    const periodTR = 700;
    const results = computeProductTrs(lots, periodTR);
    const sumTR = results.reduce((s, r) => s + r.tR, 0);
    const sumTU = results.reduce((s, r) => s + r.tU, 0);
    expect(sumTR).toBeCloseTo(periodTR, 5);
    expect(results.every(r => r.trAllocated)).toBe(true);
    expect(sumTU / periodTR).toBeCloseTo((281.67 + 149) / 700, 6);
  });

  it("falls back to lot durations without periodTR", () => {
    const lots = [
      { productId: "p1", productName: "A", cadence: 120, cadenceUnit: "u/min" as const,
        produced: 34000, conforming: 33800, lotDurationMin: 300, unplannedMin: 20, tF: 280, tN: 283.33, tU: 281.67 },
    ];
    const results = computeProductTrs(lots);
    expect(results[0].trAllocated).toBe(false);
    expect(results[0].tR).toBe(300);
  });
});
