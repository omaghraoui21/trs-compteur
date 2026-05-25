import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { fmtPct } from "@trs/engine";
import type { DailyTrs } from "@/lib/api";

interface Props {
  daily: DailyTrs[];
  objective?: number;
}

export default function TrsChart({ daily, objective }: Props) {
  if (daily.length === 0) return null;

  const data = daily.map(d => ({
    date: d.date.slice(5),
    DO: Math.round(d.DO * 10000) / 100,
    TP: Math.round(d.TP * 10000) / 100,
    TQ: Math.round(d.TQ * 10000) / 100,
    TRS: Math.round(d.TRS * 10000) / 100,
    TRG: Math.round(d.TRG * 10000) / 100,
  }));

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <h3 className="font-semibold text-sm mb-3">Évolution TRS</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
          <Tooltip
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
            labelFormatter={l => `Date: ${l}`}
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
