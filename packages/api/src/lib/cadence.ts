import { timeWeightedCadence } from "@trs/engine";

// One row of the lot_cadence_changes audit trail.
export interface CadenceChangeRow {
  oldCadence: string | number;
  newCadence: string | number;
  cadenceUnit: string;
  changedAt: Date | string;
}

const perMin = (v: number, unit: string) => (unit === "u/min" ? v : v / 60);

// Effective nominal cadence to feed computeLotTrs. With no recorded changes,
// returns the lot's own cadence unchanged (so existing lots are unaffected).
// With changes, returns the time-weighted average over the lot duration,
// normalised to u/min.
export function effectiveLotCadence(
  lot: { cadenceUsed: string | number; cadenceUnit: string; startedAt: Date | string; endedAt: Date | string | null },
  changes: CadenceChangeRow[] | undefined,
  fallbackEnd: Date | string,
): { cadence: number; cadenceUnit: "u/min" | "u/h" } {
  if (!changes || changes.length === 0) {
    return { cadence: Number(lot.cadenceUsed), cadenceUnit: lot.cadenceUnit as "u/min" | "u/h" };
  }
  const sorted = [...changes].sort(
    (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
  );
  const initial = perMin(Number(sorted[0].oldCadence), sorted[0].cadenceUnit);
  const cadence = timeWeightedCadence({
    startedAt: lot.startedAt,
    endedAt: lot.endedAt ?? fallbackEnd,
    initial,
    changes: sorted.map((c) => ({ at: c.changedAt, cadencePerMin: perMin(Number(c.newCadence), c.cadenceUnit) })),
  });
  return { cadence, cadenceUnit: "u/min" };
}
