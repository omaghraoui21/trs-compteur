import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { fmtDuration } from "@trs/engine";
import type { TrsMetrics } from "@/lib/api";
import { chartTheme } from "./chartTheme";

interface Props {
  metrics: TrsMetrics;
}

interface WaterfallStep {
  name: string;
  value: number;
  loss: number;
  base: number;
  fill: string;
  lossFill: string;
}

interface TooltipEntry {
  dataKey: string;
  value: number;
  payload: { fill: string; lossFill: string };
}

// Custom tooltip: keyed off dataKey (reliable), hides the invisible stacking
// base and any zero entries, and labels the time bar vs. the loss bar correctly.
function WaterfallTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter(p => p.dataKey !== "base" && Number(p.value) > 0)
    .map(p => ({
      name: p.dataKey === "value" ? "Temps" : "Perte",
      value: fmtDuration(Number(p.value)),
      color: p.dataKey === "value" ? p.payload.fill : p.payload.lossFill,
    }));
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border rounded-lg shadow-sm px-3 py-2 text-xs">
      <div className="font-semibold mb-1">{label}</div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm inline-block" style={{ background: r.color }} />
          <span className="text-gray-600">{r.name} :</span>
          <span className="font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function WaterfallChart({ metrics }: Props) {
  const { tT, tO, fermeture, tAP, tR, totalUnplannedMin, tF, ecartCadenceMin, tN, nonQualiteMin, tU } = metrics;

  if (tT === 0) return null;

  const steps: WaterfallStep[] = [
    { name: "tT (24h)", value: tT, loss: 0, base: 0, fill: "#94a3b8", lossFill: "" },
    { name: "Fermeture", value: 0, loss: fermeture, base: tO, fill: "", lossFill: "#cbd5e1" },
    { name: "tO", value: tO, loss: 0, base: 0, fill: "#60a5fa", lossFill: "" },
    { name: "Arrêts P.", value: 0, loss: tAP, base: tR, fill: "", lossFill: "#fbbf24" },
    { name: "tR", value: tR, loss: 0, base: 0, fill: "#3b82f6", lossFill: "" },
    { name: "Arrêts NP", value: 0, loss: totalUnplannedMin, base: tF, fill: "", lossFill: "#f97316" },
    { name: "tF", value: tF, loss: 0, base: 0, fill: "#22c55e", lossFill: "" },
    { name: "Écart cad.", value: 0, loss: Math.max(0, ecartCadenceMin), base: tN, fill: "", lossFill: "#fb923c" },
    { name: "tN", value: tN > 0 ? Math.round(tN) : 0, loss: 0, base: 0, fill: "#16a34a", lossFill: "" },
    { name: "Non qual.", value: 0, loss: Math.max(0, Math.round(nonQualiteMin)), base: Math.round(tU), fill: "", lossFill: "#ef4444" },
    { name: "tU", value: tU > 0 ? Math.round(tU) : 0, loss: 0, base: 0, fill: "#15803d", lossFill: "" },
  ];

  const data = steps.map(s => ({
    name: s.name,
    value: s.value,
    loss: s.loss,
    base: s.base,
    fill: s.fill,
    lossFill: s.lossFill,
    label: s.value > 0 ? fmtDuration(s.value) : s.loss > 0 ? `-${fmtDuration(s.loss)}` : "",
  }));

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="Cascade NF E 60-182">
      <h3 className="font-semibold text-sm mb-1">Cascade NF E 60-182</h3>
      <p className="text-xs text-gray-500 mb-3">Décomposition des pertes de temps</p>

      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridStroke} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: chartTheme.axisFont }} interval={0} angle={-40} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: chartTheme.axisFont }} tickFormatter={v => fmtDuration(v)} />
          <Tooltip content={<WaterfallTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />

          {/* Invisible base bar for stacking */}
          <Bar dataKey="base" stackId="a" fill="transparent" name="invisible" />

          {/* Value bars (the time buckets) */}
          <Bar dataKey="value" stackId="a" name="Temps" radius={[3, 3, 0, 0]} opacity={chartTheme.barOpacity}>
            {data.map((d, i) => (
              <Cell key={`v-${i}`} fill={d.fill || "transparent"} />
            ))}
            <LabelList
              dataKey="label"
              position="top"
              style={{ fontSize: 9, fill: "#374151", fontWeight: 600 }}
            />
          </Bar>

          {/* Loss bars */}
          <Bar dataKey="loss" stackId="b" name="Perte" radius={[3, 3, 0, 0]} opacity={chartTheme.barOpacity}>
            {data.map((d, i) => (
              <Cell key={`l-${i}`} fill={d.lossFill || "transparent"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-600 justify-center">
        {[
          { color: "#cbd5e1", label: "Fermeture" },
          { color: "#fbbf24", label: "Arrêts planifiés" },
          { color: "#f97316", label: "Arrêts non planifiés" },
          { color: "#fb923c", label: "Écart cadence" },
          { color: "#ef4444", label: "Non qualité" },
        ].map(item => (
          <span key={item.label} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
