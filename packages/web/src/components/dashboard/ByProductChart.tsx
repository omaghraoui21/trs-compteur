import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { fmtPct, fmtDuration } from "@trs/engine";
import type { ProductTrs } from "@/lib/api";
import { Package } from "lucide-react";

const COLORS = ["#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899"];

interface Props {
  byProduct: ProductTrs[];
}

export default function ByProductChart({ byProduct }: Props) {
  if (byProduct.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="TRS par produit">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-blue-600" /> TRS par produit
        </h3>
        <div className="text-center text-gray-400 py-8 text-sm">Aucun lot clôturé dans la période</div>
      </div>
    );
  }

  const data = byProduct.map(p => ({
    name: p.productName,
    TRS: Math.round(p.TRS * 10000) / 100,
    DO: Math.round(p.DO * 10000) / 100,
    TP: Math.round(p.TP * 10000) / 100,
    TQ: Math.round(p.TQ * 10000) / 100,
    lots: p.lotCount,
    produced: p.totalProduced,
    rebut: p.totalRebut,
    cadence: Math.round(p.avgCadencePerMin),
  }));

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="TRS par produit">
      <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <Package className="h-4 w-4 text-blue-600" /> TRS par produit
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {byProduct.length} produit(s) — TRS = ΣtU / ΣtR
        {byProduct[0]?.trAllocated && <span className="text-gray-400"> · DO réparti au prorata du temps de fonctionnement</span>}
      </p>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
          <Tooltip
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
            labelFormatter={l => String(l)}
          />
          <Bar dataKey="TRS" name="TRS" barSize={18} radius={[0, 3, 3, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} opacity={0.85} />
            ))}
            <LabelList dataKey="TRS" position="right" style={{ fontSize: 10, fill: "#374151", fontWeight: 600 }} formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Detail table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b">
              <th className="text-left py-1 px-2">Produit</th>
              <th className="text-right py-1 px-2">Lots</th>
              <th className="text-right py-1 px-2">NPR</th>
              <th className="text-right py-1 px-2">NPC</th>
              <th className="text-right py-1 px-2">Cad.</th>
              <th className="text-right py-1 px-2">{byProduct[0]?.trAllocated ? "DO*" : "DO"}</th>
              <th className="text-right py-1 px-2">TP</th>
              <th className="text-right py-1 px-2">TQ</th>
              <th className="text-right py-1 px-2 font-bold">TRS</th>
            </tr>
          </thead>
          <tbody>
            {byProduct.map((p, i) => (
              <tr key={p.productId} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-1 px-2 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: COLORS[i % COLORS.length] }} />
                  {p.productName}
                </td>
                <td className="py-1 px-2 text-right">{p.lotCount}</td>
                <td className="py-1 px-2 text-right">{p.totalProduced.toLocaleString()}</td>
                <td className="py-1 px-2 text-right text-red-600">{p.totalRebut.toLocaleString()}</td>
                <td className="py-1 px-2 text-right">{Math.round(p.avgCadencePerMin)} u/min</td>
                <td className="py-1 px-2 text-right">{fmtPct(p.DO)}</td>
                <td className="py-1 px-2 text-right">{fmtPct(p.TP)}</td>
                <td className="py-1 px-2 text-right">{fmtPct(p.TQ)}</td>
                <td className="py-1 px-2 text-right font-bold" style={{ color: p.TRS >= 0.75 ? "#22c55e" : p.TRS >= 0.55 ? "#f97316" : "#ef4444" }}>
                  {fmtPct(p.TRS)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
