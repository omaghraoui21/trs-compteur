// One row of the lot_cadence_changes audit trail.
export interface CadenceChangeRow {
  oldCadence: string | number;
  newCadence: string | number;
  cadenceUnit: string;
  changedAt: Date | string;
}

const perMin = (v: number, unit: string) => (unit === "u/min" ? v : v / 60);

// Returns the cadence inputs for computeLotTrs (which now handles time-weighting
// natively via its cadenceChanges field).
//
// - initialCadence / initialUnit : the cadence at lot start (before any changes).
// - cadenceChanges               : per-minute change transitions to pass through.
//
// When there are no recorded changes the array is empty and computeLotTrs falls
// back to the single nominal cadence (unchanged behaviour).
export function effectiveLotCadence(
  lot: { cadenceUsed: string | number; cadenceUnit: string },
  changes: CadenceChangeRow[] | undefined,
): {
  initialCadence: number;
  initialUnit: "u/min" | "u/h";
  cadenceChanges: { at: Date | string; cadencePerMin: number }[];
} {
  if (!changes || changes.length === 0) {
    return {
      initialCadence: Number(lot.cadenceUsed),
      initialUnit: lot.cadenceUnit as "u/min" | "u/h",
      cadenceChanges: [],
    };
  }
  const sorted = [...changes].sort(
    (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
  );
  return {
    // The cadence at lot start is the oldCadence of the first recorded change.
    initialCadence: Number(sorted[0].oldCadence),
    initialUnit: sorted[0].cadenceUnit as "u/min" | "u/h",
    cadenceChanges: sorted.map((c) => ({
      at: c.changedAt,
      cadencePerMin: perMin(Number(c.newCadence), c.cadenceUnit),
    })),
  };
}
