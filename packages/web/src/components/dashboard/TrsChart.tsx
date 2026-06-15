import { useState, useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { groupSessionsByPeriod, type GroupBy } from "@trs/engine";
import type { DailyTrs } from "@/lib/api";

interface Props {
  daily: DailyTrs[];
  objective?: number;
}

const GRAINS: { key: GroupBy; label: string }[] = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
];

function bucketLabel(key: string, by: GroupBy): string {
  if (by === "day") return key.slice(5);       // MM-DD
  if (by === "week") return key.replace(/^\d{4}-/, "");  // W22
  return key;                                   // YYYY-MM
}

export default function TrsChart({ daily, objective }: Props) {
  const [grain, setGrain] = useState<GroupBy>("day");

  const data = useMemo(() => {
    // Each bucket is re-aggregated as ΣtU/ΣtR — day → week → month always reconcile.
    const buckets = groupSessionsByPeriod(daily as any, grain);
    return buckets.map(b => ({
      date: bucketLabel(b.periodKey, grain),
      DO: Math.round(b.DO * 10000) / 100,
      TP: Math.round(b.TP * 10000) / 100,
      TQ: Math.round(b.TQ * 10000) / 100,
      TRS: Math.round(b.TRS * 10000) / 100,
      TRG: Math.round(b.TRG * 10000) / 100,
    }));
  }, [daily, grain]);

  if (daily.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="Évolution TRS">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="font-semibold text-sm">Évolution TRS</h3>
        <div className="flex rounded-lg border overflow-hidden text-xs">
          {GRAINS.map(g => (
            <button
              key={g.key}
              onClick={() => setGrain(g.key)}
              className={`px-2.5 py-1 transition ${grain === g.key ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
          <Tooltip
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
            labelFormatter={l => `Période: ${l}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />

          <Bar dataKey="DO" name="DO" fill="#60a5fa" opacity={0.7} stackId="kpi" barSize={20} />
          <Bar dataKey="TP" name="TP" fill="#34d399" opacity={0.7} stackId="kpi2" barSize={20} />
          <Bar dataKey="TQ" name="TQ" fill="#a78bfa" opacity={0.7} stackId="kpi3" barSize={20} />

          <Line type="monotone" dataKey="TRS" name="TRS" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} />
          <Line type="monotone" dataKey="TRG" name="TRG" stroke="#f97316" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />

          {objective != null && (
            <ReferenceLine
              y={objective}
              stroke="#ef4444"
              strokeDasharray="8 4"
              strokeWidth={2}
              label={{ value: `Objectif ${objective}%`, position: "insideTopRight", fontSize: 11, fill: "#ef4444" }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
