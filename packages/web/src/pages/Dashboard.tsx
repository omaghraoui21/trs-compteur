import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { api, type Equipment, type DashboardTrsResponse, type ParetoResponse, type ComparisonResponse, type TrsMetrics, type DailyTrs } from "@/lib/api";
import { fmtPct, fmtDuration, trsColor, familleToNorme } from "@trs/engine";
import { BarChart3, Calendar, Gauge, Download, ArrowLeftRight, ChevronDown, ChevronUp, AlertTriangle, Info } from "lucide-react";
import TrsChart from "@/components/dashboard/TrsChart";
import ParetoChart from "@/components/dashboard/ParetoChart";
import WaterfallChart from "@/components/dashboard/WaterfallChart";

type ZoomLevel = "day" | "week" | "month" | "custom";

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetDates(zoom: ZoomLevel): { from: string; to: string } {
  const now = new Date();
  if (zoom === "day") {
    const s = dateStr(now);
    return { from: s, to: s };
  }
  if (zoom === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { from: dateStr(d), to: dateStr(now) };
  }
  // month
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: dateStr(d), to: dateStr(now) };
}

export default function DashboardPage() {
  const [equipmentsList, setEquipmentsList] = useState<Equipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState("");
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<DashboardTrsResponse | null>(null);
  const [paretoData, setParetoData] = useState<ParetoResponse | null>(null);
  const [comparisonData, setComparisonData] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  useEffect(() => {
    api.equipments().then(list => {
      setEquipmentsList(list);
      if (list.length > 0) setSelectedEquipment(list[0].id);
    });
  }, []);

  const { from, to } = useMemo(() => {
    if (zoom === "custom" && customFrom && customTo) return { from: customFrom, to: customTo };
    return getPresetDates(zoom === "custom" ? "month" : zoom);
  }, [zoom, customFrom, customTo]);

  const fetchData = useCallback(async () => {
    if (!selectedEquipment || !from || !to) return;
    setLoading(true);
    try {
      const [trsRes, paretoRes] = await Promise.all([
        api.dashboardTrs(selectedEquipment, from, to),
        api.dashboardPareto(selectedEquipment, from, to),
      ]);
      setData(trsRes);
      setParetoData(paretoRes);

      if (showComparison) {
        try {
          const compRes = await api.dashboardComparison(from, to);
          setComparisonData(compRes);
        } catch {
          setComparisonData(null);
        }
      }
    } catch {
      setData(null);
      setParetoData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedEquipment, from, to, showComparison]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const eq = equipmentsList.find(e => e.id === selectedEquipment);
  const objective = eq ? Number(eq.trsObjective) : undefined;

  // CSV export (RFC 4180 compliant)
  const csvEscape = (val: unknown): string => {
    const s = String(val ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csvRow = (fields: unknown[]) => fields.map(csvEscape).join(",");
  const sanitizeFilename = (s: string) => s.replace(/[/\\:*?"<>|]/g, "_");

  const exportCsv = () => {
    if (!data?.daily?.length) return;
    const headers = ["Date", "Produit", "Lot", "tT", "tO", "Fermeture", "tAP", "tR", "tF", "tN", "tU", "Lots", "NPR", "NPB", "NPC", "DO", "TP", "TQ", "TRS", "TRG"];
    const rows = data.daily.map(d => {
      const lots = d.lots || [];
      const produits = lots.map((l: any) => l.productName).join("+");
      const batchNums = lots.map((l: any) => l.batchNumber).join("+");
      return csvRow([
        d.date, produits, batchNums,
        d.tT, d.tO, d.fermeture, d.tAP, d.tR, Math.round(d.tF), Math.round(d.tN), Math.round(d.tU),
        d.lotCount, d.totalProduced, d.totalConforming, d.totalRebut,
        (d.DO * 100).toFixed(1), (d.TP * 100).toFixed(1), (d.TQ * 100).toFixed(1),
        (d.TRS * 100).toFixed(1), (d.TRG * 100).toFixed(1),
      ]);
    });

    const t = data.total;
    rows.push(csvRow([
      "TOTAL", "", "", t.tT, t.tO, t.fermeture, t.tAP, t.tR, Math.round(t.tF), Math.round(t.tN), Math.round(t.tU),
      t.lotCount, t.totalProduced, t.totalConforming, t.totalRebut,
      (t.DO * 100).toFixed(1), (t.TP * 100).toFixed(1), (t.TQ * 100).toFixed(1),
      (t.TRS * 100).toFixed(1), (t.TRG * 100).toFixed(1),
    ]));

    const csv = [csvRow(headers), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TRS_${sanitizeFilename(eq?.name || "export")}_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5" /> Tableau de bord TRS
      </h2>

      {/* ─── Filters ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border p-4 mb-4 flex items-center gap-4 flex-wrap">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Équipement</label>
          <select value={selectedEquipment} onChange={e => setSelectedEquipment(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            {equipmentsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Période</label>
          <div className="flex border rounded-lg overflow-hidden">
            {(["day", "week", "month", "custom"] as ZoomLevel[]).map(z => (
              <button key={z} onClick={() => setZoom(z)}
                className={`px-3 py-2 text-sm ${zoom === z ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {z === "day" ? "Jour" : z === "week" ? "Semaine" : z === "month" ? "Mois" : "Libre"}
              </button>
            ))}
          </div>
        </div>

        {zoom === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="border rounded-lg px-2 py-2 text-sm" />
            <span className="text-gray-400">→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="border rounded-lg px-2 py-2 text-sm" />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowComparison(!showComparison)}
            className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg border ${showComparison ? "bg-blue-50 border-blue-300 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}>
            <ArrowLeftRight className="h-4 w-4" /> Comparer
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">Chargement...</div>}

      {!loading && data && (
        <>
          {/* ─── Comparison mode ─────────────────────────────── */}
          {showComparison && comparisonData && (
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {comparisonData.equipments.map(ceq => (
                <KpiCard key={ceq.equipmentId} metrics={ceq.total} title={ceq.equipmentName} objective={ceq.trsObjective} />
              ))}
            </div>
          )}

          {/* ─── Main KPI card ───────────────────────────────── */}
          {!showComparison && (
            <KpiCard metrics={data.total} title={eq?.name || ""} objective={objective} />
          )}

          {/* ─── Buckets temps ───────────────────────────────── */}
          <TimeBuckets metrics={data.total} />

          {/* ─── Charts row ──────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <TrsChart daily={data.daily} objective={objective} />
            {paretoData && <ParetoChart pareto={paretoData.pareto} totalMin={paretoData.totalMin} />}
          </div>

          {/* ─── Waterfall ───────────────────────────────────── */}
          <div className="mb-4">
            <WaterfallChart metrics={data.total} />
          </div>

          {/* ─── Daily breakdown table ───────────────────────── */}
          <DailyTable
            daily={data.daily}
            total={data.total}
            expandedDay={expandedDay}
            onToggleDay={d => setExpandedDay(expandedDay === d ? null : d)}
            exportCsv={exportCsv}
          />
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function KpiCard({ metrics, title, objective }: { metrics: TrsMetrics; title: string; objective?: number }) {
  if (metrics.lotCount === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Gauge className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold">TRS Consolidé — {title}</h3>
        </div>
        <div className="text-center text-gray-400 py-8">Aucune donnée pour cette période</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <Gauge className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold">TRS Consolidé — {title}</h3>
      </div>

      <div className="grid grid-cols-5 gap-3 text-center mb-4">
        {([
          { label: "TRS", value: metrics.TRS },
          { label: "TRG", value: metrics.TRG },
          { label: "DO", value: metrics.DO },
          { label: "TP", value: metrics.TP },
          { label: "TQ", value: metrics.TQ },
        ]).map(item => (
          <div key={item.label} className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500 mb-1">{item.label}</div>
            <div className="text-2xl font-bold" style={{ color: ["TRS", "TRG"].includes(item.label) ? trsColor(item.value) : undefined }}>
              {fmtPct(item.value)}
            </div>
          </div>
        ))}
      </div>

      {objective != null && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${metrics.TRS >= objective / 100 ? "bg-green-500" : "bg-red-500"}`} />
          Objectif: {objective}% — {metrics.TRS >= objective / 100 ? "Atteint ✓" : "Non atteint"}
        </div>
      )}

      <WarningsBanner warnings={metrics.warnings} audit={metrics.audit} />
    </div>
  );
}

function WarningsBanner({ warnings, audit }: { warnings?: TrsMetrics["warnings"]; audit?: TrsMetrics["audit"] }) {
  if ((!warnings || warnings.length === 0) && !audit?.tF_delta) return null;

  const errors = warnings?.filter(w => w.level === "error") || [];
  const warns = warnings?.filter(w => w.level === "warning") || [];

  return (
    <div className="mt-3 space-y-1">
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-red-700 space-y-0.5">
            {errors.map((w, i) => <div key={i}>{w.message}</div>)}
          </div>
        </div>
      )}
      {warns.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-700 space-y-0.5">
            {warns.map((w, i) => <div key={i}>{w.message}</div>)}
          </div>
        </div>
      )}
      {audit && Math.abs(audit.tF_delta) > 5 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-700">
            Audit: {audit.formula} (écart lots: {audit.tF_delta.toFixed(0)}min)
          </div>
        </div>
      )}
    </div>
  );
}

function TimeBuckets({ metrics }: { metrics: TrsMetrics }) {
  const buckets = [
    { label: "tT (24h)", value: fmtDuration(metrics.tT), color: "text-gray-600" },
    { label: "tO", value: fmtDuration(metrics.tO), color: "text-blue-600" },
    { label: "Fermeture", value: fmtDuration(metrics.fermeture), color: "text-gray-400" },
    { label: "tAP", value: fmtDuration(metrics.tAP), color: "text-yellow-600" },
    { label: "tR", value: fmtDuration(metrics.tR), color: "text-blue-700" },
    { label: "Arrêts NP", value: fmtDuration(metrics.totalUnplannedMin), color: "text-orange-600" },
    { label: "tF", value: fmtDuration(metrics.tF), color: "text-green-600" },
    { label: "tN", value: fmtDuration(Math.round(metrics.tN)), color: "text-green-700" },
    { label: "tU", value: fmtDuration(Math.round(metrics.tU)), color: "text-green-800" },
    { label: "Lots", value: String(metrics.lotCount) },
    { label: "NPR", value: metrics.totalProduced.toLocaleString() },
    { label: "NPB", value: metrics.totalConforming.toLocaleString() },
    { label: "NPC", value: metrics.totalRebut.toLocaleString(), color: "text-red-600" },
  ];

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 mb-4">
      <h3 className="font-semibold text-sm mb-3">Décomposition temps & quantités</h3>
      <div className="grid grid-cols-4 sm:grid-cols-7 lg:grid-cols-13 gap-2">
        {buckets.map(b => (
          <div key={b.label} className="bg-gray-50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-gray-500">{b.label}</div>
            <div className={`font-semibold text-sm ${b.color || ""}`}>{b.value}</div>
          </div>
        ))}
      </div>

      {/* Downtime by famille + NF E 60-182 codes */}
      {Object.keys(metrics.downtimeByFamille).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(metrics.downtimeByFamille)
            .sort(([, a], [, b]) => b - a)
            .map(([famille, min]) => {
              const normeCode = familleToNorme(famille);
              const showNormeCode = normeCode !== famille;
              return (
                <span key={famille} className="inline-flex items-center gap-1 bg-orange-50 text-orange-800 rounded-full px-2 py-0.5 text-xs">
                  {showNormeCode && <span className="font-mono font-bold">{normeCode}</span>}
                  {famille}: {fmtDuration(min)}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

function DailyTable({ daily, total, expandedDay, onToggleDay, exportCsv }: {
  daily: DailyTrs[];
  total: TrsMetrics;
  expandedDay: string | null;
  onToggleDay: (date: string) => void;
  exportCsv: () => void;
}) {
  if (!daily.length) return null;

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <h3 className="font-semibold text-sm">Détail par jour</h3>
        </div>
        <button onClick={exportCsv}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <Download className="h-3 w-3" /> Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="px-3 py-2 text-left"></th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-right">tO</th>
              <th className="px-3 py-2 text-right">tAP</th>
              <th className="px-3 py-2 text-right">tR</th>
              <th className="px-3 py-2 text-right">tF</th>
              <th className="px-3 py-2 text-right">Lots</th>
              <th className="px-3 py-2 text-right">NPR</th>
              <th className="px-3 py-2 text-right">NPC</th>
              <th className="px-3 py-2 text-right">DO</th>
              <th className="px-3 py-2 text-right">TP</th>
              <th className="px-3 py-2 text-right">TQ</th>
              <th className="px-3 py-2 text-right">TRS</th>
              <th className="px-3 py-2 text-right">TRG</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {daily.map(d => (
              <Fragment key={d.date}>
                <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => onToggleDay(d.date)}>
                  <td className="px-3 py-2">
                    {d.lots && d.lots.length > 0 && (
                      expandedDay === d.date ? <ChevronUp className="h-3 w-3 text-gray-400" /> : <ChevronDown className="h-3 w-3 text-gray-400" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium flex items-center gap-1">
                    {d.date}
                    {d.warnings && d.warnings.filter(w => w.level === "error").length > 0 && (
                      <span className="inline-flex items-center bg-red-100 text-red-700 rounded px-1 text-[10px] font-bold">
                        {d.warnings.filter(w => w.level === "error").length} err
                      </span>
                    )}
                    {d.warnings && d.warnings.filter(w => w.level === "warning").length > 0 && (
                      <span className="inline-flex items-center bg-amber-100 text-amber-700 rounded px-1 text-[10px] font-bold">
                        {d.warnings.filter(w => w.level === "warning").length} warn
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tO)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tAP)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tR)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(Math.round(d.tF))}</td>
                  <td className="px-3 py-2 text-right">{d.lotCount}</td>
                  <td className="px-3 py-2 text-right">{d.totalProduced.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-red-600">{d.totalRebut}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(d.DO)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(d.TP)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(d.TQ)}</td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: trsColor(d.TRS) }}>{fmtPct(d.TRS)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: trsColor(d.TRG) }}>{fmtPct(d.TRG)}</td>
                </tr>
                {/* U7: Enhanced lot drill-down */}
                {expandedDay === d.date && d.lots && d.lots.map((lot: any) => (
                  <tr key={lot.lotId} className="bg-blue-50/50 text-xs">
                    <td className="px-3 py-1.5"></td>
                    <td className="px-3 py-1.5 text-gray-600 pl-6">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">└</span>
                        <span className="font-medium">{lot.productName}</span>
                        <span className="text-gray-400">({lot.batchNumber})</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        Cadence: {lot.cadencePerMin ? `${lot.cadencePerMin.toFixed(0)} u/min` : "—"}
                        {lot.unplannedMin > 0 && <span className="ml-2 text-red-500">Arrêts NP: {fmtDuration(lot.unplannedMin)}</span>}
                        {lot.ecartCadence != null && lot.ecartCadence > 5 && (
                          <span className="ml-2 text-amber-600">Ecart cadence: {fmtDuration(Math.round(lot.ecartCadence))}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{fmtDuration(lot.lotDurationMin)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{fmtDuration(lot.plannedMin || 0)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">—</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{fmtDuration(Math.round(lot.tF))}</td>
                    <td className="px-3 py-1.5 text-right">1</td>
                    <td className="px-3 py-1.5 text-right">{lot.quantityProduced?.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-red-500">{lot.rebut}</td>
                    <td className="px-3 py-1.5 text-right">—</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: lot.TP > 1 ? "#d97706" : undefined }}>{fmtPct(lot.TP)}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: lot.TQ > 1 ? "#dc2626" : undefined }}>{fmtPct(lot.TQ)}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: trsColor(lot.TP * lot.TQ) }}>{fmtPct(lot.TP * lot.TQ)}</td>
                    <td className="px-3 py-1.5 text-right">—</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {/* TOTAL row */}
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2">TOTAL</td>
              <td className="px-3 py-2 text-right">{fmtDuration(total.tO)}</td>
              <td className="px-3 py-2 text-right">{fmtDuration(total.tAP)}</td>
              <td className="px-3 py-2 text-right">{fmtDuration(total.tR)}</td>
              <td className="px-3 py-2 text-right">{fmtDuration(Math.round(total.tF))}</td>
              <td className="px-3 py-2 text-right">{total.lotCount}</td>
              <td className="px-3 py-2 text-right">{total.totalProduced.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-red-600">{total.totalRebut}</td>
              <td className="px-3 py-2 text-right">{fmtPct(total.DO)}</td>
              <td className="px-3 py-2 text-right">{fmtPct(total.TP)}</td>
              <td className="px-3 py-2 text-right">{fmtPct(total.TQ)}</td>
              <td className="px-3 py-2 text-right" style={{ color: trsColor(total.TRS) }}>{fmtPct(total.TRS)}</td>
              <td className="px-3 py-2 text-right" style={{ color: trsColor(total.TRG) }}>{fmtPct(total.TRG)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
