import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { fmtDuration } from "@trs/engine";
import type { ParetoItem } from "@/lib/api";

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280"];

interface Props {
  pareto: ParetoItem[];
  totalMin: number;
  onSelectCode?: (code: string) => void;
}

export default function ParetoChart({ pareto, totalMin, onSelectCode }: Props) {
  if (pareto.length === 0) return (
    <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="Pareto des arrêts">
      <h3 className="font-semibold text-sm mb-3">Pareto des arrêts</h3>
      <div className="text-center text-gray-400 py-8 text-sm">Aucun arrêt enregistré</div>
    </div>
  );

  const top10 = pareto.slice(0, 10);

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="Pareto des arrêts">
      <h3 className="font-semibold text-sm mb-1">Pareto des arrêts</h3>
      <p className="text-xs text-gray-500 mb-3">Total : {fmtDuration(totalMin)} — Top {top10.length} causes</p>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={top10} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, angle: -35, textAnchor: "end" }}
            interval={0}
            height={80}
          />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `${v} min`} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
          <Tooltip
            formatter={(value, name) => {
              const v = Number(value);
              return String(name) === "Cumul" ? [`${v.toFixed(1)}%`, String(name)] : [`${v} min (${fmtDuration(v)})`, String(name)];
            }}
          />

          <Bar yAxisId="left" dataKey="totalMin" name="Durée" barSize={30}>
            {top10.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} opacity={0.85} />
            ))}
          </Bar>

          <Line yAxisId="right" type="monotone" dataKey="cumulPct" name="Cumul" stroke="#1e293b" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b">
              <th scope="col" className="text-left py-1 px-2">Cause</th>
              <th scope="col" className="text-left py-1 px-2">Famille</th>
              <th scope="col" className="text-right py-1 px-2">Durée</th>
              <th scope="col" className="text-right py-1 px-2">Nb</th>
              <th scope="col" className="text-right py-1 px-2">%</th>
              <th scope="col" className="text-right py-1 px-2">Cumul</th>
            </tr>
          </thead>
          <tbody>
            {top10.map((item, i) => (
              <tr key={item.code}
                className={`border-b border-gray-100 hover:bg-gray-50 ${onSelectCode ? "cursor-pointer" : ""}`}
                onClick={() => onSelectCode?.(item.code)}>
                <td className="py-1 px-2 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: COLORS[i % COLORS.length] }} />
                  {item.label}
                  {onSelectCode && <span className="ml-1 text-[10px] text-blue-400">↗</span>}
                </td>
                <td className="py-1 px-2 text-gray-500">{item.famille}</td>
                <td className="py-1 px-2 text-right font-medium">{fmtDuration(item.totalMin)}</td>
                <td className="py-1 px-2 text-right">{item.count}</td>
                <td className="py-1 px-2 text-right">{item.pctOfTotal.toFixed(1)}%</td>
                <td className="py-1 px-2 text-right">{item.cumulPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
