import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { fmtDuration } from "@trs/engine";
import type { SixLossesResult } from "@/lib/api";
import { AlertTriangle } from "lucide-react";

const LOSS_COLORS: Record<string, string> = {
  breakdown: "#ef4444",
  setup: "#f97316",
  micro_stop: "#eab308",
  speed_loss: "#3b82f6",
  startup_reject: "#8b5cf6",
  production_reject: "#ec4899",
};

const OEE_RING_COLORS: Record<string, string> = {
  availability: "#60a5fa",
  performance: "#34d399",
  quality: "#a78bfa",
};

interface Props {
  data: SixLossesResult;
}

export default function SixLossesChart({ data }: Props) {
  const { losses, totalLossMin, tT } = data;

  const nonZeroLosses = losses.filter(l => l.minutes > 0);
  if (nonZeroLosses.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" /> 6 Grandes Pertes (Nakajima)
        </h3>
        <div className="text-center text-gray-400 py-8 text-sm">Aucune perte enregistrée</div>
      </div>
    );
  }

  const chartData = losses.map(l => ({
    name: l.label,
    minutes: l.minutes,
    pct: Math.round(l.pctOfTotal * 100) / 100,
    category: l.category,
    oeeComponent: l.oeeComponent,
  }));

  // Group by OEE component for summary
  const byComponent: Record<string, number> = {};
  for (const l of losses) {
    byComponent[l.oeeComponent] = (byComponent[l.oeeComponent] || 0) + l.minutes;
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" /> 6 Grandes Pertes (Nakajima/TPM)
      </h3>
      <p className="text-xs text-gray-500 mb-3">Classification NF E 60-182 — Total pertes : {fmtDuration(totalLossMin)}</p>

      {/* OEE component summary pills */}
      <div className="flex gap-2 mb-3">
        {[
          { key: "availability", label: "Disponibilité", icon: "DO" },
          { key: "performance", label: "Performance", icon: "TP" },
          { key: "quality", label: "Qualité", icon: "TQ" },
        ].map(c => (
          <div key={c.key} className="flex-1 rounded-lg border p-2 text-center" style={{ borderColor: OEE_RING_COLORS[c.key] + "80" }}>
            <div className="text-[10px] text-gray-500">{c.label} ({c.icon})</div>
            <div className="text-sm font-bold" style={{ color: OEE_RING_COLORS[c.key] }}>
              {fmtDuration(byComponent[c.key] || 0)}
            </div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtDuration(v)} />
          <Tooltip
            formatter={(value, name) => {
              const v = Number(value);
              return String(name) === "minutes"
                ? [fmtDuration(v), "Durée"]
                : [`${v.toFixed(1)}%`, "% de tT"];
            }}
            labelFormatter={l => String(l)}
          />
          <Bar dataKey="minutes" name="minutes" barSize={40} radius={[3, 3, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={LOSS_COLORS[d.category] || "#6b7280"} opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Detail table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b">
              <th className="text-left py-1 px-2">Perte</th>
              <th className="text-left py-1 px-2">Composante</th>
              <th className="text-right py-1 px-2">Durée</th>
              <th className="text-right py-1 px-2">% de tT</th>
            </tr>
          </thead>
          <tbody>
            {losses.map(l => (
              <tr key={l.category} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-1 px-2 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: LOSS_COLORS[l.category] || "#6b7280" }} />
                  {l.label}
                </td>
                <td className="py-1 px-2">
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: OEE_RING_COLORS[l.oeeComponent] + "20", color: OEE_RING_COLORS[l.oeeComponent] }}>
                    {l.oeeComponent === "availability" ? "DO" : l.oeeComponent === "performance" ? "TP" : "TQ"}
                  </span>
                </td>
                <td className="py-1 px-2 text-right font-medium">{fmtDuration(l.minutes)}</td>
                <td className="py-1 px-2 text-right">{l.pctOfTotal.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
