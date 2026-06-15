/** Convert a Date or ISO string to minutes since midnight */
export function toMinutes(dt: Date | string): number {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.getHours() * 60 + d.getMinutes();
}

/** Difference in minutes between two timestamps */
export function diffMinutes(start: Date | string, end: Date | string): number {
  const s = typeof start === "string" ? new Date(start).getTime() : start.getTime();
  const e = typeof end === "string" ? new Date(end).getTime() : end.getTime();
  return Math.max(0, Math.round((e - s) / 60_000));
}

/** Format minutes as "Xh YYmin" */
export function fmtDuration(min: number): string {
  const rounded = Math.round(min);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Format a ratio as percentage string */
export function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Format an integer with French thousands separators (e.g. 12345 → "12 345") */
export function fmtNumber(n: number): string {
  return n.toLocaleString("fr-FR");
}

/** TRS color: green >= 75%, orange >= 55%, red < 55% */
export function trsColor(ratio: number): string {
  if (ratio >= 0.75) return "#22c55e";
  if (ratio >= 0.55) return "#f97316";
  return "#ef4444";
}
