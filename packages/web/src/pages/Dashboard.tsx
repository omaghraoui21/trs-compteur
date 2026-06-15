import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { api, type Equipment, type DashboardTrsResponse, type ParetoResponse, type ParetoItem, type ComparisonResponse, type TrsMetrics, type DailyTrs, type ByProductResponse, type SixLossesResponse, type HeatmapResponse, type DowntimeLogEntry, type DowntimeLogResponse } from "@/lib/api";
import { fmtPct, fmtDuration, fmtNumber, trsColor, familleToNorme, computeOeeBenchmark } from "@trs/engine";
import type { BenchmarkRating } from "@trs/engine";
import { useToast } from "@/components/Toast";
import { DashboardSkeleton } from "@/components/Skeleton";
import { BarChart3, Calendar, Gauge, Download, ArrowLeftRight, ChevronDown, ChevronUp, AlertTriangle, Info, FileText, RefreshCw, Loader2 } from "lucide-react";
// PDF is lazy-loaded on demand to reduce bundle size
import TrsChart from "@/components/dashboard/TrsChart";
import ParetoChart from "@/components/dashboard/ParetoChart";
import WaterfallChart from "@/components/dashboard/WaterfallChart";
import TrsVerificationPanel from "@/components/dashboard/TrsVerificationPanel";
import ByProductChart from "@/components/dashboard/ByProductChart";
import SixLossesChart from "@/components/dashboard/SixLossesChart";
import HeatmapChart from "@/components/dashboard/HeatmapChart";

type ZoomLevel = "day" | "week" | "month" | "custom";

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return dateStr(d);
}

function getPreviousPeriod(from: string, to: string, zoom: ZoomLevel): { from: string; to: string } {
  if (zoom === "day") return { from: shiftDays(from, -1), to: shiftDays(to, -1) };
  if (zoom === "week") return { from: shiftDays(from, -7), to: shiftDays(to, -7) };
  if (zoom === "month") {
    const d = new Date(from);
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return { from: dateStr(first), to: dateStr(last) };
  }
  // custom: shift back by the same duration
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  return { from: shiftDays(from, -days), to: shiftDays(to, -days) };
}

function getPresetDates(zoom: ZoomLevel, ref = new Date()): { from: string; to: string } {
  if (zoom === "day") {
    const s = dateStr(ref);
    return { from: s, to: s };
  }
  if (zoom === "week") {
    // ISO calendar week: Monday → Sunday
    const d = new Date(ref);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    const mon = new Date(d);
    mon.setDate(d.getDate() - dow);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: dateStr(mon), to: dateStr(sun) };
  }
  // month: 1st → last day of the calendar month
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { from: dateStr(first), to: dateStr(last) };
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
  const [byProductData, setByProductData] = useState<ByProductResponse | null>(null);
  const [sixLossesData, setSixLossesData] = useState<SixLossesResponse | null>(null);
  const [heatmapData, setHeatmapData] = useState<HeatmapResponse | null>(null);
  const [downtimeLog, setDowntimeLog] = useState<DowntimeLogResponse | null>(null);
  const [prevData, setPrevData] = useState<DashboardTrsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [equipFailed, setEquipFailed] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [drillCode, setDrillCode] = useState<string | null>(null);
  const toast = useToast();

  const loadEquipments = useCallback(() => {
    setEquipFailed(false);
    api.equipments().then(list => {
      setEquipmentsList(list);
      if (list.length > 0) setSelectedEquipment(list[0].id);
    }).catch((err) => {
      setEquipFailed(true);
      toast.error(err.message || "Chargement des équipements échoué");
    });
  }, [toast]);

  useEffect(() => { loadEquipments(); }, [loadEquipments]);

  const { from, to } = useMemo(() => {
    if (zoom === "custom" && customFrom && customTo) return { from: customFrom, to: customTo };
    return getPresetDates(zoom === "custom" ? "month" : zoom);
  }, [zoom, customFrom, customTo]);

  const fetchData = useCallback(async () => {
    if (!selectedEquipment || !from || !to) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const prev = getPreviousPeriod(from, to, zoom);
      const [trsRes, paretoRes, prodRes, lossesRes, heatRes, logRes, prevRes] = await Promise.all([
        api.dashboardTrs(selectedEquipment, from, to),
        api.dashboardPareto(selectedEquipment, from, to),
        api.dashboardByProduct(selectedEquipment, from, to).catch(() => null),
        api.dashboardSixLosses(selectedEquipment, from, to).catch(() => null),
        api.dashboardHeatmap(selectedEquipment, from, to).catch(() => null),
        api.dashboardDowntimeLog(selectedEquipment, from, to).catch(() => null),
        api.dashboardTrs(selectedEquipment, prev.from, prev.to).catch(() => null),
      ]);
      setData(trsRes);
      setParetoData(paretoRes);
      setByProductData(prodRes);
      setSixLossesData(lossesRes);
      setHeatmapData(heatRes);
      setDowntimeLog(logRes);
      setPrevData(prevRes);

      if (showComparison) {
        try {
          const compRes = await api.dashboardComparison(from, to);
          setComparisonData(compRes);
        } catch {
          setComparisonData(null);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Chargement du tableau de bord échoué");
      setLoadFailed(true);
      setData(null);
      setParetoData(null);
      setByProductData(null);
      setSixLossesData(null);
      setHeatmapData(null);
      setDowntimeLog(null);
      setPrevData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedEquipment, from, to, zoom, showComparison]);

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
    if (!data?.daily?.length) { toast.error("Aucune donnée à exporter pour cette période."); return; }
    const headers = ["Date", "Produit", "Lot", "tT", "tO", "Fermeture", "tAP", "tR", "tF", "tN", "tU", "Lots", "NPR", "NPB", "NPC", "DO", "TP", "TQ", "TRS", "TRG", "Non classé (min)"];
    const rows = data.daily.map(d => {
      const lots = d.lots || [];
      const produits = lots.map((l: any) => l.productName).join("+");
      const batchNums = lots.map((l: any) => l.batchNumber).join("+");
      return csvRow([
        d.date, produits, batchNums,
        d.tT, d.tO, d.fermeture, d.tAP, d.tR, Math.round(d.tF), Math.round(d.tN), Math.round(d.tU),
        d.lotCount, d.totalProduced, d.totalConforming, d.totalRebut,
        (d.DO * 100).toFixed(1), (d.TP * 100).toFixed(1), (d.TQ * 100).toFixed(1),
        (d.TRS * 100).toFixed(1), (d.TRG * 100).toFixed(1), d.aClasserMin ?? 0,
      ]);
    });

    const t = data.total;
    rows.push(csvRow([
      "TOTAL", "", "", t.tT, t.tO, t.fermeture, t.tAP, t.tR, Math.round(t.tF), Math.round(t.tN), Math.round(t.tU),
      t.lotCount, t.totalProduced, t.totalConforming, t.totalRebut,
      (t.DO * 100).toFixed(1), (t.TP * 100).toFixed(1), (t.TQ * 100).toFixed(1),
      (t.TRS * 100).toFixed(1), (t.TRG * 100).toFixed(1), t.aClasserMin ?? 0,
    ]));

    const csv = [csvRow(headers), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TRS_${sanitizeFilename(eq?.name || "export")}_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export CSV téléchargé");
  };

  const exportPdf = async () => {
    if (!data || pdfLoading) return;
    setPdfLoading(true);
    try {
      const [{ pdf }, { default: PdfReport }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/dashboard/PdfReport"),
      ]);
      const doc = (
        <PdfReport
          total={data.total}
          daily={data.daily}
          equipmentName={eq?.name || ""}
          equipmentCode={eq?.code}
          from={from}
          to={to}
          byProduct={byProductData?.byProduct}
          sixLosses={sixLossesData?.total.losses}
        />
      );
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TRS_${sanitizeFilename(eq?.name || "export")}_${from}_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export PDF téléchargé");
    } catch (err: any) {
      toast.error("Génération PDF échouée");
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5" aria-hidden="true" /> Tableau de bord TRS
      </h2>

      {/* ─── Filters ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border p-4 mb-4 flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="equipment-select" className="block text-xs text-gray-500 mb-1">Équipement</label>
          <select id="equipment-select" value={selectedEquipment} onChange={e => setSelectedEquipment(e.target.value)}
            className="w-full sm:w-auto border rounded-lg px-3 py-2 text-sm">
            {equipmentsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Période</label>
          <div className="flex border rounded-lg overflow-hidden">
            {(["day", "week", "month", "custom"] as ZoomLevel[]).map(z => (
              <button key={z} onClick={() => setZoom(z)}
                aria-pressed={zoom === z}
                className={`px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${zoom === z ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {z === "day" ? "Jour" : z === "week" ? "Sem." : z === "month" ? "Mois" : "Libre"}
              </button>
            ))}
          </div>
        </div>

        {zoom === "custom" && (() => {
          const dateRangeInvalid = !!customFrom && !!customTo && customTo < customFrom;
          return (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                aria-label="Date de début" className="border rounded-lg px-2 py-2 text-sm" />
              <span className="text-gray-400" aria-hidden="true">→</span>
              <input type="date" value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                min={customFrom || undefined}
                aria-label="Date de fin"
                aria-invalid={dateRangeInvalid}
                className={`border rounded-lg px-2 py-2 text-sm ${dateRangeInvalid ? "border-red-400" : ""}`} />
              {dateRangeInvalid && (
                <p role="alert" className="text-xs text-red-600 w-full">La date de fin doit être égale ou postérieure à la date de début.</p>
              )}
            </div>
          );
        })()}

        <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
          <button onClick={() => setShowComparison(!showComparison)}
            aria-pressed={showComparison}
            className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${showComparison ? "bg-blue-50 border-blue-300 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}>
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> Comparer
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50">
            <Download className="h-4 w-4" aria-hidden="true" /> CSV
          </button>
          <button onClick={exportPdf} disabled={pdfLoading}
            className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
            {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
            {pdfLoading ? "PDF…" : "PDF"}
          </button>
        </div>
      </div>

      {equipFailed && equipmentsList.length === 0 && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
          <p className="font-medium text-gray-700">Impossible de charger la liste des équipements.</p>
          <p className="text-sm mt-1 mb-4">Vérifiez votre connexion, puis réessayez.</p>
          <button onClick={loadEquipments}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}

      {loading && <DashboardSkeleton />}

      {!loading && !data && loadFailed && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
          <p className="font-medium text-gray-700">Impossible de charger le tableau de bord.</p>
          <p className="text-sm mt-1 mb-4">Vérifiez votre connexion, puis réessayez.</p>
          <button onClick={fetchData}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ─── Comparison mode ─────────────────────────────── */}
          {showComparison && comparisonData && (
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Best→worst TRS so the strongest/weakest lines surface at a glance.
                  Copy before sort (non-mutating); `|| 0` keeps zero-lot equipments
                  (NaN/0 TRS) from destabilizing the comparator. */}
              {[...comparisonData.equipments]
                .sort((a, b) => (b.total.TRS || 0) - (a.total.TRS || 0))
                .map((ceq, i) => (
                  <KpiCard key={ceq.equipmentId} metrics={ceq.total} title={ceq.equipmentName} subtitle={`${from} → ${to}`} rank={i + 1} objective={ceq.trsObjective} />
                ))}
            </div>
          )}

          {/* ─── Headline stat strip ─────────────────────────── */}
          {!showComparison && <StatStrip metrics={data.total} />}

          {/* ─── Main KPI card ───────────────────────────────── */}
          {!showComparison && (
            <>
              {prevData && prevData.total.lotCount > 0 && (() => {
                const prev = getPreviousPeriod(from, to, zoom);
                return (
                  <p className="text-xs text-gray-400 mb-2 text-right">
                    ↑↓ vs période précédente : {prev.from} → {prev.to}
                  </p>
                );
              })()}
              <KpiCard metrics={data.total} title={eq?.name || ""} subtitle={`${from} → ${to}`} objective={objective} prevMetrics={prevData?.total ?? undefined} />
            </>
          )}

          {/* ─── Line Performance band ───────────────────────── */}
          {!showComparison && <LinePerformanceBand daily={data.daily} />}

          {/* ─── Buckets temps ───────────────────────────────── */}
          <TimeBuckets metrics={data.total} />

          {/* ─── Classification quality KPI (GMP data integrity) */}
          <ClassificationQualityCard total={data.total} />

          {/* ─── Charts row ──────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <TrsChart daily={data.daily} objective={objective} />
            {paretoData
              ? <ParetoChart pareto={paretoData.pareto} totalMin={paretoData.totalMin} onSelectCode={setDrillCode} />
              : <ChartUnavailable label="Pareto des arrêts" onRetry={() => api.dashboardPareto(selectedEquipment, from, to).then(setParetoData).catch(() => {})} />}
          </div>

          {/* ─── Pareto drill-down modal ─────────────────────── */}
          {drillCode && paretoData && downtimeLog && (
            <ParetoDrillModal
              code={drillCode}
              pareto={paretoData.pareto}
              log={downtimeLog.log}
              onClose={() => setDrillCode(null)}
            />
          )}

          {/* ─── By-Product + Six Losses row ───────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {byProductData
              ? <ByProductChart byProduct={byProductData.byProduct} />
              : <ChartUnavailable label="TRS par produit" onRetry={() => api.dashboardByProduct(selectedEquipment, from, to).then(setByProductData).catch(() => {})} />}
            {sixLossesData
              ? <SixLossesChart data={sixLossesData.total} />
              : <ChartUnavailable label="Six grandes pertes" onRetry={() => api.dashboardSixLosses(selectedEquipment, from, to).then(setSixLossesData).catch(() => {})} />}
          </div>

          {/* ─── Cascade + Verification row ──────────────────── */}
          {!showComparison && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <WaterfallChart metrics={data.total} />
              <TrsVerificationPanel metrics={data.total} />
            </div>
          )}

          {/* ─── Heatmap row ─────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {heatmapData
              ? <HeatmapChart heatmap={heatmapData.heatmap} />
              : <ChartUnavailable label="Heatmap horaire" onRetry={() => api.dashboardHeatmap(selectedEquipment, from, to).then(setHeatmapData).catch(() => {})} />}
          </div>

          {/* ─── Daily breakdown table ───────────────────────── */}
          <DailyTable
            daily={data.daily}
            total={data.total}
            expandedDay={expandedDay}
            onToggleDay={d => setExpandedDay(expandedDay === d ? null : d)}
            exportCsv={exportCsv}
          />

          {/* ─── Chronological downtime log ──────────────────── */}
          {downtimeLog && <DowntimeLog log={downtimeLog.log} />}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

const RATING_LABELS: Record<BenchmarkRating, { label: string; cls: string }> = {
  world_class: { label: "Classe mondiale", cls: "bg-green-100 text-green-700" },
  acceptable:  { label: "Acceptable",      cls: "bg-amber-100 text-amber-700" },
  below:       { label: "En dessous",      cls: "bg-red-100 text-red-700" },
};

function BenchmarkBadge({ rating }: { rating: BenchmarkRating }) {
  const { label, cls } = RATING_LABELS[rating];
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

// Period-wide state-timeline band (Grafana "Line Performance" style). Each day
// is a column whose height is split into execute / planned-stop / unplanned-stop
// / other, proportional to the day's open time (tO). Built from the daily array
// already fetched — no chart lib, no extra request.
const BAND_STATES = [
  { key: "execute",   label: "Production",          color: "#22c55e" },
  { key: "unplanned", label: "Arrêt non planifié",  color: "#ef4444" },
  { key: "planned",   label: "Arrêt planifié",      color: "#fbbf24" },
  { key: "other",     label: "Autre / fermeture",   color: "#cbd5e1" },
] as const;

function LinePerformanceBand({ daily }: { daily: DailyTrs[] }) {
  if (!daily.length) return null;
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 mb-4" role="region" aria-label="Line Performance">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-5 w-5 text-blue-600" aria-hidden="true" />
        <h3 className="font-semibold">Line Performance</h3>
      </div>
      <div className="flex items-end gap-0.5 h-36">
        {daily.map(d => {
          const execute = Math.max(Math.round(d.tF), 0);
          const unplanned = Math.max(d.totalUnplannedMin, 0);
          const planned = Math.max(d.tAP, 0);
          const other = Math.max(d.tO - execute - unplanned - planned, 0);
          const mins: Record<(typeof BAND_STATES)[number]["key"], number> = { execute, unplanned, planned, other };
          const total = execute + unplanned + planned + other || 1;
          const title = `${d.date}\nProduction ${fmtDuration(execute)} · Arrêt NP ${fmtDuration(unplanned)} · Arrêt P ${fmtDuration(planned)}`;
          return (
            <div key={d.date} className="flex-1 flex flex-col justify-end h-full min-w-0" title={title}>
              <div className="flex flex-col-reverse h-full rounded-sm overflow-hidden bg-gray-50">
                {BAND_STATES.map(s => mins[s.key] > 0 && (
                  <div key={s.key} style={{ height: `${(mins[s.key] / total) * 100}%`, backgroundColor: s.color }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-gray-400">
        <span>{daily[0]?.date}</span>
        {daily.length > 1 && <span>{daily[daily.length - 1]?.date}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
        {BAND_STATES.map(s => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Shared event-date formatter used by ParetoDrillModal and DowntimeLog.
function fmtEventDate(iso: string, showYear = false): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", ...(showYear ? { year: "2-digit" } : {}),
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Classification quality KPI (GMP / data-integrity signal) ─
// Headline: à-classer ratio (aClasserMin / tR) — wall-clock time not covered
// by any declared stop. Secondary: declared stops with no famille, when present.

const CLASS_THRESHOLDS = [
  { min: 15, color: "#dc2626", bgCls: "bg-red-50 border-red-200",   label: "Traçabilité insuffisante — action requise" },
  { min:  5, color: "#d97706", bgCls: "bg-amber-50 border-amber-200", label: "Classement à améliorer" },
  { min:  0, color: "#16a34a", bgCls: "bg-green-50 border-green-200", label: "Bonne traçabilité" },
] as const;

function ClassificationQualityCard({ total }: { total: TrsMetrics & { aClasserMin?: number } }) {
  const aClasser = total.aClasserMin ?? 0;
  const tR = total.tR;
  if (tR <= 0) return null;

  const pct = Math.min((aClasser / tR) * 100, 100);
  const nonQualifie = total.downtimeByFamille?.["Non classé"] ?? 0;

  const { color, bgCls, label: statusLabel } = CLASS_THRESHOLDS.find(t => pct >= t.min) ?? CLASS_THRESHOLDS[2];

  return (
    <div className={`rounded-xl border p-4 mb-4 ${bgCls}`} role="region" aria-label="Qualité de classement GMP">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-0.5">Qualité de classement</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold" style={{ color }}>{pct.toFixed(1)}%</span>
            <span className="text-sm text-gray-500">de temps non classé</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">{fmtDuration(aClasser)} non classé sur {fmtDuration(tR)} requis</div>
          {nonQualifie > 0 && (
            <div className="text-xs text-gray-500 mt-0.5">dont {fmtDuration(nonQualifie)} d'arrêts déclarés sans famille</div>
          )}
          {/* Visual progress bar — markers derived from CLASS_THRESHOLDS */}
          <div className="relative h-2 bg-white/60 rounded-full overflow-hidden mt-3 border border-black/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
            {CLASS_THRESHOLDS.filter(t => t.min > 0).map(t => (
              <div key={t.min} className="absolute top-0 h-full w-px bg-black/20" style={{ left: `${t.min}%` }} />
            ))}
          </div>
          <div className="relative text-[9px] text-gray-400 mt-0.5 h-3">
            {CLASS_THRESHOLDS.filter(t => t.min > 0).map(t => (
              <span key={t.min} className="absolute" style={{ left: `${t.min}%`, transform: "translateX(-50%)" }}>{t.min}%</span>
            ))}
          </div>
        </div>
        <div className="text-xs text-gray-400 max-w-[160px] text-right shrink-0">{statusLabel}</div>
      </div>
    </div>
  );
}

// ─── Pareto drill-down modal ──────────────────────────────────
// Shows the individual stop events behind a selected Pareto cause.
function ParetoDrillModal({ code, pareto, log, onClose }: {
  code: string;
  pareto: ParetoItem[];
  log: DowntimeLogEntry[];
  onClose: () => void;
}) {
  const cause = pareto.find(p => p.code === code);
  const isPhase = cause?.isPhase ?? false;
  const events = useMemo(
    () => isPhase ? [] : log.filter(e => e.categoryCode === code),
    [isPhase, code, log],
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      onKeyDown={e => { if (e.key === "Escape") onClose(); }}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pareto-drill-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 id="pareto-drill-title" className="font-semibold">{cause?.label ?? code}</h3>
            {cause && <p className="text-xs text-gray-400 mt-0.5">{cause.famille} · {fmtDuration(cause.totalMin)} · {cause.count} occurrence{cause.count > 1 ? "s" : ""}</p>}
          </div>
          <button onClick={onClose} aria-label="Fermer" className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          {isPhase ? (
            <p className="text-sm text-gray-500 text-center py-8">Détail indisponible pour les phases planifiées.</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">Aucun événement trouvé pour cette cause.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th scope="col" className="text-left py-1 px-2">Date / Heure</th>
                  <th scope="col" className="text-right py-1 px-2">Durée</th>
                  <th scope="col" className="text-left py-1 px-2">Lot</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 px-2">{fmtEventDate(e.startedAt)}</td>
                    <td className="py-1.5 px-2 text-right font-medium">{fmtDuration(e.durationMinutes)}</td>
                    <td className="py-1.5 px-2 text-gray-500">{e.batchNumber || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Chronological stop-by-stop log (Grafana "DownTime Editor" style). Read-only
// table sorted newest-first, fed by GET /dashboard/downtime-log.
function DowntimeLog({ log }: { log: DowntimeLogEntry[] }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm mt-4 overflow-hidden" role="region" aria-label="Journal des arrêts">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
        <h3 className="font-semibold">Journal des arrêts</h3>
        <span className="ml-auto text-xs text-gray-400">{log.length} arrêt{log.length > 1 ? "s" : ""}</span>
      </div>
      {log.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400 text-sm">Aucun arrêt sur la période</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Journal des arrêts">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left border-b">
                <th className="px-4 py-2 font-medium" scope="col">Date</th>
                <th className="px-4 py-2 font-medium text-right" scope="col">Durée</th>
                <th className="px-4 py-2 font-medium" scope="col">Type</th>
                <th className="px-4 py-2 font-medium" scope="col">Famille</th>
                <th className="px-4 py-2 font-medium" scope="col">Raison</th>
                <th className="px-4 py-2 font-medium" scope="col">Lot</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {log.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                    {fmtEventDate(e.startedAt, true)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtDuration(e.durationMinutes)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${e.isPlanned ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                      {e.isPlanned ? "Planifié" : "Non planifié"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{e.famille}</td>
                  <td className="px-4 py-2.5">{e.reason}</td>
                  <td className="px-4 py-2.5 text-gray-500">{e.batchNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Line-Performance-style headline strip: six at-a-glance numbers above the
// detailed KPI card. All values come straight off the period total already
// fetched — no extra request.
// Placeholder for an optional chart whose data failed to load (the fetch uses
// .catch(() => null) so one failing chart never blanks the whole dashboard).
function ChartUnavailable({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <div className="bg-white rounded-xl border p-6 flex flex-col items-center justify-center text-center text-gray-400 min-h-[200px]">
      <BarChart3 className="h-7 w-7 mb-2 text-gray-300" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="text-xs mt-1">Données indisponibles pour cette période.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded px-2 py-1"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Réessayer
        </button>
      )}
    </div>
  );
}

function StatStrip({ metrics }: { metrics: TrsMetrics }) {
  if (metrics.lotCount === 0) return null;
  const heldMin = metrics.tAP + metrics.totalUnplannedMin;
  const downtimeHeavy = metrics.tR > 0 && heldMin / metrics.tR > 0.3;
  const cards: { label: string; value: string; sub?: string; color?: string }[] = [
    { label: "Production", value: fmtNumber(metrics.totalProduced), sub: "pièces produites" },
    { label: "Conformes", value: fmtNumber(metrics.totalConforming), sub: `${fmtNumber(metrics.totalRebut)} rebuts` },
    { label: "Temps d'arrêt", value: fmtDuration(heldMin), sub: "planifiés + non planifiés", color: downtimeHeavy ? "#dc2626" : undefined },
    { label: "Temps de marche", value: fmtDuration(Math.round(metrics.tF)), sub: "tF" },
    { label: "Disponibilité", value: fmtPct(metrics.DO), sub: "DO", color: trsColor(metrics.DO) },
    { label: "Performance", value: fmtPct(metrics.TP), sub: "TP", color: trsColor(metrics.TP) },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4" role="region" aria-label="Résumé de production">
      {cards.map(c => (
        <div key={c.label} className="bg-white rounded-xl border shadow-sm p-4 text-center">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{c.label}</div>
          <div className="text-2xl font-bold tabular-nums" style={c.color ? { color: c.color } : undefined}>{c.value}</div>
          {c.sub && <div className="text-[11px] text-gray-400 mt-0.5">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Delta({ curr, prev }: { curr: number; prev: number }) {
  const pp = (curr - prev) * 100;
  if (Math.abs(pp) < 0.05) return null;
  const up = pp > 0;
  return (
    <span className={`text-[10px] font-semibold ${up ? "text-green-600" : "text-red-500"}`}>
      {up ? "↑" : "↓"}{Math.abs(pp).toFixed(1)} pp
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold shrink-0"
      aria-label={`Rang ${rank} par TRS`}
    >
      #{rank}
    </span>
  );
}

function KpiCard({ metrics, title, subtitle, rank, objective, prevMetrics }: { metrics: TrsMetrics; title: string; subtitle?: string; rank?: number; objective?: number; prevMetrics?: TrsMetrics }) {
  if (metrics.lotCount === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6 mb-4" role="region" aria-label={`TRS Consolidé — ${title}`}>
        <div className="flex items-center gap-2 mb-4">
          {rank != null && <RankBadge rank={rank} />}
          <Gauge className="h-5 w-5 text-blue-600" aria-hidden="true" />
          <div>
            <h3 className="font-semibold leading-tight">TRS Consolidé — {title}</h3>
            {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
          </div>
        </div>
        <div className="text-center text-gray-400 py-8">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 text-gray-300" aria-hidden="true" />
          <p className="font-medium text-gray-500">Aucune donnée pour cette période</p>
          <p className="text-sm mt-1">Ajustez les filtres ou sélectionnez une autre plage.</p>
        </div>
      </div>
    );
  }

  const bench = computeOeeBenchmark({ DO: metrics.DO, TP: metrics.TP, TQ: metrics.TQ, TRS: metrics.TRS }, "pharmaceutical");
  const rel = metrics.reliability;

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 mb-4" role="region" aria-label={`TRS Consolidé — ${title}`}>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          {rank != null && <RankBadge rank={rank} />}
          <Gauge className="h-5 w-5 text-blue-600" aria-hidden="true" />
          <div>
            <h3 className="font-semibold leading-tight">TRS Consolidé — {title}</h3>
            {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
          </div>
        </div>
        <BenchmarkBadge rating={bench.ratings.TRS} />
      </div>

      {/* Primary OEE grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-center mb-3">
        {([
          { label: "TRS",  value: metrics.TRS,  prev: prevMetrics?.TRS,  rating: bench.ratings.TRS },
          { label: "TRG",  value: metrics.TRG,  prev: prevMetrics?.TRG,  rating: null },
          { label: "DO",   value: metrics.DO,   prev: prevMetrics?.DO,   rating: bench.ratings.DO },
          { label: "TP",   value: metrics.TP,   prev: prevMetrics?.TP,   rating: bench.ratings.TP },
          { label: "TQ",   value: metrics.TQ,   prev: prevMetrics?.TQ,   rating: bench.ratings.TQ },
        ] as { label: string; value: number; prev?: number; rating: BenchmarkRating | null }[]).map(item => (
          <div key={item.label} className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500 mb-1">{item.label}</div>
            <div className="text-2xl font-bold" style={{ color: ["TRS", "TRG"].includes(item.label) ? trsColor(item.value) : undefined }}>
              {fmtPct(item.value)}
            </div>
            {item.prev != null && prevMetrics && prevMetrics.lotCount > 0 && (
              <div className="mt-0.5 flex justify-center"><Delta curr={item.value} prev={item.prev} /></div>
            )}
            {item.rating && <div className="mt-1"><BenchmarkBadge rating={item.rating} /></div>}
          </div>
        ))}
      </div>

      {/* Production summary strip */}
      <div className="grid grid-cols-3 gap-3 text-center text-sm mb-3">
        <div className="bg-green-50 rounded-xl p-3">
          <div className="text-xs text-green-700 mb-1">Fonctionnement (tF)</div>
          <div className="text-lg font-bold text-green-800">{fmtDuration(Math.round(metrics.tF))}</div>
        </div>
        <div className="bg-blue-50 rounded-xl p-3">
          <div className="text-xs text-blue-700 mb-1">Prod. totale (NPR)</div>
          <div className="text-lg font-bold text-blue-800">{fmtNumber(metrics.totalProduced)}</div>
        </div>
        <div className={`rounded-xl p-3 ${metrics.totalProduced > 0 && metrics.totalRebut / metrics.totalProduced > 0.05 ? "bg-red-50" : "bg-gray-50"}`}>
          <div className="text-xs text-gray-500 mb-1">Taux de rebut</div>
          <div className={`text-lg font-bold ${metrics.totalProduced > 0 && metrics.totalRebut / metrics.totalProduced > 0.05 ? "text-red-600" : ""}`}>
            {metrics.totalProduced > 0 ? `${((metrics.totalRebut / metrics.totalProduced) * 100).toFixed(1)} %` : "—"}
          </div>
          {metrics.totalRebut > 0 && <div className="text-[10px] text-gray-400 mt-0.5">{fmtNumber(metrics.totalRebut)} unités</div>}
        </div>
      </div>

      {/* TEEP + Reliability row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm mb-3">
        <div className="bg-blue-50 rounded-xl p-3">
          <div className="text-xs text-blue-600 mb-1 font-medium">TEEP</div>
          <div className="text-xl font-bold text-blue-700">{fmtPct(metrics.TEEP ?? 0)}</div>
          <div className="text-[10px] text-blue-500 mt-0.5">vs calendrier 24/7</div>
        </div>
        <div className={`rounded-xl p-3 ${(metrics.utilisation ?? 0) > 1 ? "bg-amber-50" : "bg-gray-50"}`}>
          <div className="text-xs text-gray-500 mb-1">Utilisation</div>
          <div className={`text-xl font-bold ${(metrics.utilisation ?? 0) > 1 ? "text-amber-600" : ""}`}>
            {fmtPct(metrics.utilisation ?? 0)}
          </div>
          {(metrics.utilisation ?? 0) > 1 ? (
            <div className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-0.5"><AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />&gt;100% — vérifier les données</div>
          ) : (
            <div className="text-[10px] text-gray-400 mt-0.5">tO / 24h</div>
          )}
        </div>
        {rel && rel.mtbf != null && (
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500 mb-1">MTBF</div>
            <div className="text-xl font-bold">{Math.round(rel.mtbf)} min</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{rel.breakdownCount} panne{rel.breakdownCount > 1 ? "s" : ""}</div>
          </div>
        )}
        {rel && rel.mttr != null && (
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500 mb-1">MTTR</div>
            <div className="text-xl font-bold">{Math.round(rel.mttr)} min</div>
            <div className="text-[10px] text-gray-400 mt-0.5">durée moy. panne</div>
          </div>
        )}
      </div>

      {objective != null && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${metrics.TRS >= objective / 100 ? "bg-green-500" : "bg-red-500"}`} />
          Objectif: {objective}% — {metrics.TRS >= objective / 100 ? "Atteint" : "Non atteint"}
        </div>
      )}

      {/* Benchmark reference */}
      <div className="mt-3 text-[11px] text-gray-400 border-t pt-2">
        Référence pharma : TRS ≥ {(bench.thresholds.trs.worldClass * 100).toFixed(0)}% (classe mondiale) · DO ≥ {(bench.thresholds.DO.worldClass * 100).toFixed(0)}% · TP ≥ {(bench.thresholds.TP.worldClass * 100).toFixed(0)}% · TQ ≥ {(bench.thresholds.TQ.worldClass * 100).toFixed(1)}%
      </div>

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
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="text-xs text-red-700 space-y-0.5">
            {errors.map((w, i) => <div key={i}>{w.message}</div>)}
          </div>
        </div>
      )}
      {warns.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="text-xs text-amber-700 space-y-0.5">
            {warns.map((w, i) => <div key={i}>{w.message}</div>)}
          </div>
        </div>
      )}
      {audit && Math.abs(audit.tF_delta) > 5 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
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
    { label: "NPR", value: fmtNumber(metrics.totalProduced) },
    { label: "NPB", value: fmtNumber(metrics.totalConforming) },
    { label: "NPC", value: fmtNumber(metrics.totalRebut), color: "text-red-600" },
  ];

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 mb-4" role="region" aria-label="Décomposition temps et quantités">
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
    <div className="bg-white rounded-xl border shadow-sm" role="region" aria-label="Détail par jour">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" aria-hidden="true" />
          <h3 className="font-semibold text-sm">Détail par jour</h3>
        </div>
        <button onClick={exportCsv}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <Download className="h-3 w-3" aria-hidden="true" /> Export CSV
        </button>
      </div>
      <div className="relative overflow-auto max-h-[480px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
            <tr className="text-gray-500 text-sm">
              <th className="px-3 py-2 text-left" scope="col"></th>
              <th className="px-3 py-2 text-left" scope="col">Date</th>
              <th className="px-3 py-2 text-right" scope="col">tO</th>
              <th className="px-3 py-2 text-right" scope="col">tAP</th>
              <th className="px-3 py-2 text-right" scope="col">tR</th>
              <th className="px-3 py-2 text-right" scope="col">tF</th>
              <th className="px-3 py-2 text-right" scope="col">Lots</th>
              <th className="px-3 py-2 text-right" scope="col">NPR</th>
              <th className="px-3 py-2 text-right" scope="col">NPC</th>
              <th className="px-3 py-2 text-right" scope="col">DO</th>
              <th className="px-3 py-2 text-right" scope="col">TP</th>
              <th className="px-3 py-2 text-right" scope="col">TQ</th>
              <th className="px-3 py-2 text-right" scope="col">TRS</th>
              <th className="px-3 py-2 text-right" scope="col">TRG</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {daily.map(d => (
              <Fragment key={d.date}>
                <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => onToggleDay(d.date)}>
                  <td className="px-3 py-2">
                    {d.lots && d.lots.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={expandedDay === d.date}
                        aria-label={expandedDay === d.date ? "Réduire les lots" : "Afficher les lots"}
                        onClick={e => { e.stopPropagation(); onToggleDay(d.date); }}
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                      >
                        {expandedDay === d.date ? <ChevronUp className="h-3 w-3 text-gray-400" aria-hidden="true" /> : <ChevronDown className="h-3 w-3 text-gray-400" aria-hidden="true" />}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-1 flex-wrap">
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
                    </div>
                    {d.notes && (
                      <div className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[14rem]" title={d.notes}>
                        📝 {d.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tO)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tAP)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tR)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(Math.round(d.tF))}</td>
                  <td className="px-3 py-2 text-right">{d.lotCount}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(d.totalProduced)}</td>
                  <td className="px-3 py-2 text-right text-red-600">{fmtNumber(d.totalRebut)}</td>
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
                          <span className="ml-2 text-amber-600">Écart cadence : {fmtDuration(Math.round(lot.ecartCadence))}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{fmtDuration(lot.lotDurationMin)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{fmtDuration(lot.plannedMin || 0)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">—</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{fmtDuration(Math.round(lot.tF))}</td>
                    <td className="px-3 py-1.5 text-right">1</td>
                    <td className="px-3 py-1.5 text-right">{lot.quantityProduced?.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-1.5 text-right text-red-500">{fmtNumber(lot.rebut ?? 0)}</td>
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
              <th className="px-3 py-2 text-left" scope="row">TOTAL</th>
              <td className="px-3 py-2 text-right">{fmtDuration(total.tO)}</td>
              <td className="px-3 py-2 text-right">{fmtDuration(total.tAP)}</td>
              <td className="px-3 py-2 text-right">{fmtDuration(total.tR)}</td>
              <td className="px-3 py-2 text-right">{fmtDuration(Math.round(total.tF))}</td>
              <td className="px-3 py-2 text-right">{total.lotCount}</td>
              <td className="px-3 py-2 text-right">{fmtNumber(total.totalProduced)}</td>
              <td className="px-3 py-2 text-right text-red-600">{fmtNumber(total.totalRebut)}</td>
              <td className="px-3 py-2 text-right">{fmtPct(total.DO)}</td>
              <td className="px-3 py-2 text-right">{fmtPct(total.TP)}</td>
              <td className="px-3 py-2 text-right">{fmtPct(total.TQ)}</td>
              <td className="px-3 py-2 text-right" style={{ color: trsColor(total.TRS) }}>{fmtPct(total.TRS)}</td>
              <td className="px-3 py-2 text-right" style={{ color: trsColor(total.TRG) }}>{fmtPct(total.TRG)}</td>
            </tr>
          </tbody>
        </table>
        {/* Fade hint on mobile to indicate horizontal scroll */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent lg:hidden" />
      </div>
      <p className="lg:hidden text-[11px] text-gray-400 text-center py-1.5 border-t">← Glissez pour voir les métriques →</p>
    </div>
  );
}
