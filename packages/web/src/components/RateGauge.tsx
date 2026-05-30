import { trsColor } from "@trs/engine";

// Dependency-free SVG semicircle gauge (no chart lib). Shows a live value on a
// colored arc relative to a target/setpoint — e.g. current cadence vs the
// reference rate. Color follows the same green/amber/red thresholds as TRS.

function point(cx: number, cy: number, r: number, t: number) {
  // t in [0,1]: 0 = left end, 0.5 = top, 1 = right end of the semicircle.
  const angle = Math.PI * (1 - t);
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

function arc(cx: number, cy: number, r: number, t0: number, t1: number) {
  const s = point(cx, cy, r, t0);
  const e = point(cx, cy, r, t1);
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

export function RateGauge({
  value,
  max,
  label = "Cadence",
  unit,
}: {
  value: number;
  max?: number | null;
  label?: string;
  unit?: string;
}) {
  const hasTarget = typeof max === "number" && max > 0;
  const ratio = hasTarget ? Math.min(Math.max(value / max, 0), 1) : 0;
  const color = hasTarget ? trsColor(ratio) : "#9ca3af";

  const cx = 100;
  const cy = 100;
  const r = 80;

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 flex flex-col items-center">
      <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">{label}</div>
      <svg viewBox="0 0 200 116" className="w-full max-w-[220px]" role="img"
        aria-label={`${label} ${value}${unit ? " " + unit : ""}${hasTarget ? ` sur ${max}` : ""}`}>
        {/* track */}
        <path d={arc(cx, cy, r, 0, 1)} fill="none" stroke="#e5e7eb" strokeWidth="14" strokeLinecap="round" />
        {/* value */}
        {hasTarget && ratio > 0 && (
          <path d={arc(cx, cy, r, 0, ratio)} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" />
        )}
        {/* center value */}
        <text x={cx} y={cy - 8} textAnchor="middle" className="font-bold" fontSize="34" fill={color}>
          {Number.isFinite(value) ? Math.round(value) : "—"}
        </text>
        {unit && (
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="12" fill="#9ca3af">{unit}</text>
        )}
      </svg>
      {hasTarget ? (
        <div className="text-xs text-gray-500 -mt-1">
          Consigne <span className="font-semibold text-gray-700">{max}</span>
          {unit ? ` ${unit}` : ""} · <span style={{ color }}>{(ratio * 100).toFixed(0)}%</span>
        </div>
      ) : (
        <div className="text-xs text-gray-400 -mt-1">Pas de consigne de référence</div>
      )}
    </div>
  );
}
