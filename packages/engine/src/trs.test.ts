import { describe, it, expect } from "vitest";
import { computeLotTrs, computeSessionTrs, computeZoomTrs } from "./trs";

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
    // Based on Excel row A7: Aeronide 200µg, lot 26013
    // tF (lot duration - unplanned stops): 292 min
    // NPR: 34987, NPB: 34794, NPC: 193
    // Cadence: 120 blister/min
    const result = computeLotTrs({
      cadence: 120,
      cadenceUnit: "u/min",
      produced: 34987,
      conforming: 34794,
      startedAt: new Date("2026-05-04T09:15:00Z"),
      endedAt: new Date("2026-05-04T16:55:00Z"), // 460 min total
      downtimes: [
        { durationMinutes: 168, isPlanned: false }, // unplanned stops
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.tF).toBe(292);
    expect(result!.TP).toBeCloseTo(0.998, 2);
    expect(result!.TQ).toBeCloseTo(34794 / 34987, 3);
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
    // 7200 u/h = 120 u/min
    const result = computeLotTrs({
      cadence: 7200,
      cadenceUnit: "u/h",
      produced: 7200,
      conforming: 7200,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T10:00:00Z"), // 60 min
      downtimes: [],
    });
    expect(result).not.toBeNull();
    expect(result!.cadencePerMin).toBe(120);
    expect(result!.tN).toBe(60); // 7200 / 120 = 60 min
    expect(result!.TP).toBe(1); // perfect performance
  });

  it("computes Géluleuse lot at 1020 gél/min", () => {
    // Based on Excel G: Aeronide 400µg, cadence 1020 gél/min
    const result = computeLotTrs({
      cadence: 1020,
      cadenceUnit: "u/min",
      produced: 306000,
      conforming: 305000,
      startedAt: new Date("2026-05-04T09:00:00Z"),
      endedAt: new Date("2026-05-04T14:00:00Z"), // 300 min
      downtimes: [
        { durationMinutes: 20, isPlanned: false },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.tF).toBe(280);
    expect(result!.cadencePerMin).toBe(1020);
    expect(result!.TQ).toBeCloseTo(305000 / 306000, 3);
  });
});

describe("computeSessionTrs", () => {
  it("computes consolidated TRS for a session with 2 lots", () => {
    // Session: 08:00 → 17:00 = 540 min
    // Planned stops: nettoyage(30) + vide_ligne(15) + chsb(15) + remplissage(15) + pause(30) + remplissage(15) = 120 min
    // tR = 540 - 120 = 420 min
    const lot1 = {
      lotDurationMin: 225, unplannedMin: 15, tF: 210, tN: 200, tU: 198,
      TP: 200 / 210, TQ: 0.99, cadencePerMin: 120, ecartCadence: 10,
      produced: 24000, conforming: 23760,
    };
    const lot2 = {
      lotDurationMin: 195, unplannedMin: 0, tF: 195, tN: 190, tU: 188,
      TP: 190 / 195, TQ: 0.99, cadencePerMin: 120, ecartCadence: 5,
      produced: 22800, conforming: 22560,
    };
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-04T08:00:00Z"),
      closedAt: new Date("2026-05-04T17:00:00Z"),
      plannedStopsMin: 120,
      lots: [lot1, lot2],
    });

    expect(result.tO).toBe(540);
    expect(result.tR).toBe(420);
    expect(result.tF).toBe(405);   // 210 + 195
    expect(result.lotCount).toBe(2);
    expect(result.totalProduced).toBe(46800);
    expect(result.totalConforming).toBe(46320);
    expect(result.DO).toBeCloseTo(405 / 420, 3);
    expect(result.TRS).toBeGreaterThan(0);
    expect(result.TRS).toBeLessThanOrEqual(1);
    // TRS = DO × TP × TQ
    expect(result.TRS).toBeCloseTo(result.DO * result.TP * result.TQ, 2);
  });

  it("handles empty session (no lots)", () => {
    const result = computeSessionTrs({
      openedAt: new Date("2026-05-15T08:00:00Z"),
      closedAt: new Date("2026-05-15T17:00:00Z"),
      plannedStopsMin: 540, // all time is planned stop (nettoyage majeur)
      lots: [],
    });
    expect(result.tO).toBe(540);
    expect(result.tR).toBe(0);
    expect(result.TRS).toBe(0);
    expect(result.lotCount).toBe(0);
  });
});

describe("computeZoomTrs", () => {
  it("aggregates multiple sessions (monthly zoom)", () => {
    const session1 = {
      tO: 540, tAP: 120, tR: 420, tF: 405, tN: 390, tU: 386,
      DO: 405 / 420, TP: 390 / 405, TQ: 0.99,
      TRS: 386 / 420, TRG: 386 / 540,
      lotCount: 2, totalProduced: 46800, totalConforming: 46320,
    };
    const session2 = {
      tO: 480, tAP: 90, tR: 390, tF: 370, tN: 360, tU: 355,
      DO: 370 / 390, TP: 360 / 370, TQ: 0.985,
      TRS: 355 / 390, TRG: 355 / 480,
      lotCount: 1, totalProduced: 43200, totalConforming: 42552,
    };

    const result = computeZoomTrs({ sessions: [session1, session2] });

    expect(result.tO).toBe(1020);         // 540 + 480
    expect(result.tR).toBe(810);          // 420 + 390
    expect(result.lotCount).toBe(3);      // 2 + 1
    expect(result.totalProduced).toBe(90000);
    expect(result.TRS).toBeGreaterThan(0);
    expect(result.TRS).toBeLessThanOrEqual(1);
  });

  it("returns zeros for empty zoom", () => {
    const result = computeZoomTrs({ sessions: [] });
    expect(result.TRS).toBe(0);
    expect(result.tO).toBe(0);
  });
});
