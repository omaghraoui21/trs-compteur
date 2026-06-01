// Small aggregation helpers shared by the session-TRS and dashboard paths so
// the grouping/splitting logic lives in one place.

/** Group rows into a Map keyed by `key(row)`, preserving insertion order. */
export function groupBy<T, K>(items: T[], key: (it: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/** Sum stop minutes split by the planned flag (planned → tAP, unplanned → tF loss). */
export function splitPlannedUnplanned(
  rows: { durationMinutes: number; isPlanned: boolean }[],
): { plannedMin: number; unplannedMin: number } {
  let plannedMin = 0;
  let unplannedMin = 0;
  for (const r of rows) {
    if (r.isPlanned) plannedMin += r.durationMinutes;
    else unplannedMin += r.durationMinutes;
  }
  return { plannedMin, unplannedMin };
}
